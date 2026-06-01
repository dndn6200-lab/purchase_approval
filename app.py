import os
import re
import json
from flask import Flask, render_template, request, jsonify, send_from_directory
from bs4 import BeautifulSoup
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def clean_amount(text):
    """숫자와 쉼표만 남기고 단위(원, 천원 등) 처리"""
    if not text:
        return ''
    text = str(text).strip()
    # 천원 단위 표기 처리
    if '천원' in text:
        text = text.replace('천원', '000').replace(',', '')
    # 원 단위 제거, 쉼표 정리
    text = re.sub(r'[원\s]', '', text)
    # 숫자와 쉼표만 남김
    nums = re.sub(r'[^\d,]', '', text)
    if nums:
        try:
            num = int(nums.replace(',', ''))
            return f"{num:,}"
        except ValueError:
            return nums
    return text


def parse_html_content(html_content):
    """HTML 내용을 파싱하여 구매검수 관련 필드를 추출"""
    soup = BeautifulSoup(html_content, 'lxml')

    for tag in soup(['script', 'style', 'head']):
        tag.decompose()

    extracted = {}

    # 테이블 기반 파싱: 라벨-값 쌍 추출
    label_value_map = {}
    tables = soup.find_all('table')
    for table in tables:
        rows = table.find_all('tr')
        for row in rows:
            cells = row.find_all(['td', 'th'])
            texts = [c.get_text(strip=True) for c in cells]
            # 2칸씩 슬라이딩하며 라벨-값 쌍으로 저장
            for i in range(len(texts) - 1):
                if texts[i]:
                    label_value_map[texts[i]] = texts[i + 1]

    # dl/dt/dd 구조 파싱
    for dl in soup.find_all('dl'):
        dts = dl.find_all('dt')
        dds = dl.find_all('dd')
        for dt, dd in zip(dts, dds):
            label_value_map[dt.get_text(strip=True)] = dd.get_text(strip=True)

    # span/div 라벨-값 쌍 (같은 부모 아래)
    for parent in soup.find_all(['tr', 'li', 'div', 'p']):
        children_text = [c.get_text(strip=True) for c in parent.children
                         if hasattr(c, 'get_text') and c.get_text(strip=True)]
        if len(children_text) >= 2:
            label_value_map[children_text[0]] = children_text[1]

    def find_value(keywords):
        for label, value in label_value_map.items():
            for kw in keywords:
                if kw in label:
                    return value.strip()
        return ''

    # 파트 (기계/전기/제어 키워드 직접 검색)
    full_text = soup.get_text()
    part_match = re.search(r'(기계|전기|제어)', full_text)
    if part_match:
        extracted['part'] = part_match.group(1)

    extracted['contract_name'] = find_value(['계약명', '품목명', '품명', '공사명'])
    extracted['contract_date'] = find_value(['계약일자', '계약일', '계약 일자'])
    extracted['contract_amount'] = clean_amount(find_value(['계약금액', '총계약금액', '총금액']))
    extracted['supplier'] = find_value(['공급업체', '업체명', '거래처', '납품업체', '공급자'])
    extracted['current_inspection'] = clean_amount(find_value(['금회검수금액', '금회검수', '금회 검수']))
    extracted['prev_cumulative'] = clean_amount(find_value(['전회누계검수', '전회누계', '전회 누계']))
    extracted['cumulative_inspection'] = clean_amount(find_value(['누적검수금액', '누적검수', '누적 검수']))
    extracted['remaining_amount'] = clean_amount(find_value(['미검수잔액', '미검수 잔액', '잔액']))
    extracted['inspection_result'] = find_value(['검수결과', '검수 결과'])

    # 지체상금: 있음/없음 또는 퍼센트 추출
    liquidated_raw = find_value(['지체상금'])
    if not liquidated_raw:
        # 텍스트에서 지체상금 관련 패턴 탐색
        ld_match = re.search(r'지체상금[^\d]*(\d[\d.,\s%]+)', full_text)
        if ld_match:
            liquidated_raw = ld_match.group(1).strip()
    extracted['liquidated_damages'] = liquidated_raw

    # 빈 문자열 제거
    return {k: v for k, v in extracted.items() if v}


def format_approval_document(data, include_attachments=True):
    """결재문 형식으로 포맷팅"""

    def fmt(key, default=''):
        return str(data.get(key, default)).strip()

    def fmt_amount(key):
        val = fmt(key)
        if val and not val.endswith('원'):
            # 이미 포맷된 숫자면 원 붙이기
            if re.match(r'^[\d,]+$', val):
                return val + '원'
        return val

    contract_number = fmt('contract_number')
    lines = []

    lines.append('=' * 50)
    lines.append('           구매검수 결재문')
    lines.append('=' * 50)
    lines.append('')

    lines.append('▶ 구매대상')
    lines.append(f'  파트         : {fmt("part")}')
    lines.append(f'  계약명       : {fmt("contract_name")}')
    lines.append(f'  계약번호     : {contract_number}')
    lines.append(f'  계약일       : {fmt("contract_date")}')
    lines.append(f'  계약금액     : {fmt_amount("contract_amount")}')
    lines.append(f'  공급업체     : {fmt("supplier")}')
    lines.append('')

    lines.append('▶ 검수결과')
    lines.append(f'  계약번호     : {contract_number}')
    lines.append(f'  납기일       : {fmt("delivery_date")}')
    lines.append(f'  검수일       : {fmt("inspection_date")}')
    lines.append(f'  전회누계검수 : {fmt_amount("prev_cumulative")}')
    lines.append(f'  금회검수금액 : {fmt_amount("current_inspection")}')
    lines.append(f'  누적검수금액 : {fmt_amount("cumulative_inspection")}')
    lines.append(f'  미검수잔액   : {fmt_amount("remaining_amount")}')
    lines.append(f'  검수결과     : {fmt("inspection_result")}')
    lines.append('')

    lines.append('▶ 기타 계약조건')
    lines.append(f'  계약번호     : {contract_number}')
    lines.append(f'  하자보증금   : {fmt_amount("warranty_deposit")}')
    lines.append(f'  하자보증기간 : {fmt("warranty_period")}')
    lines.append(f'  지체상금     : {fmt("liquidated_damages")}')
    lines.append(f'  지체/면제사유: {fmt("delay_reason")}')
    lines.append('')

    if include_attachments:
        attachments = data.get('attachments', [])
        if attachments:
            lines.append('▶ 첨부파일')
            for i, att in enumerate(attachments, 1):
                lines.append(f'  {i}. {att}')
            lines.append('')

    lines.append('=' * 50)

    return '\n'.join(lines)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/parse-html', methods=['POST'])
def api_parse_html():
    data = request.json or {}
    html_content = data.get('html', '')
    if not html_content:
        return jsonify({'error': 'HTML 내용이 없습니다.'}), 400
    extracted = parse_html_content(html_content)
    return jsonify(extracted)


@app.route('/api/upload-file', methods=['POST'])
def api_upload_file():
    if 'file' not in request.files:
        return jsonify({'error': '파일이 없습니다.'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '파일명이 없습니다.'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': '허용되지 않는 파일 형식입니다.'}), 400

    filename = secure_filename(file.filename)
    # 동일 파일명 충돌 방지
    base, ext = os.path.splitext(filename)
    counter = 1
    save_name = filename
    while os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], save_name)):
        save_name = f"{base}_{counter}{ext}"
        counter += 1

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], save_name)
    file.save(filepath)

    return jsonify({'filename': save_name, 'original': file.filename})


@app.route('/api/delete-file', methods=['POST'])
def api_delete_file():
    data = request.json or {}
    filename = data.get('filename', '')
    if not filename:
        return jsonify({'error': '파일명이 없습니다.'}), 400
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(filename))
    if os.path.exists(filepath):
        os.remove(filepath)
    return jsonify({'success': True})


@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/generate', methods=['POST'])
def api_generate():
    data = request.json or {}
    output = format_approval_document(data)
    return jsonify({'output': output})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
