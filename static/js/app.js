/* === 상태 관리 === */
const state = {
  uploadedFiles: [],  // { filename, original, type }
};

/* === 초기화 === */
document.addEventListener('DOMContentLoaded', () => {
  setupDropZone();
  setupContractNumberSync();
  setupPartCustom();
});

/* === 섹션 접기/펼치기 === */
function toggleSection(id) {
  const el = document.getElementById(id);
  const btn = el.previousElementSibling.querySelector('.btn-toggle');
  if (el.style.display === 'none') {
    el.style.display = '';
    btn.textContent = '접기 ▲';
  } else {
    el.style.display = 'none';
    btn.textContent = '펼치기 ▼';
  }
}

/* === 계약번호 동기화 === */
function setupContractNumberSync() {
  const src = document.getElementById('contract-number');
  const targets = [
    document.getElementById('insp-contract-number'),
    document.getElementById('other-contract-number'),
  ];
  src.addEventListener('input', () => {
    targets.forEach(t => { t.value = src.value; });
  });
}

/* === 파트 라디오 + 직접입력 === */
function setupPartCustom() {
  const radios = document.querySelectorAll('input[name="part"]');
  const custom = document.getElementById('part-custom');
  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) custom.value = '';
    });
  });
  custom.addEventListener('input', () => {
    if (custom.value) {
      radios.forEach(r => { r.checked = false; });
    }
  });
}

function getPartValue() {
  const custom = document.getElementById('part-custom').value.trim();
  if (custom) return custom;
  const checked = document.querySelector('input[name="part"]:checked');
  return checked ? checked.value : '';
}

function setPartValue(val) {
  const radios = document.querySelectorAll('input[name="part"]');
  const custom = document.getElementById('part-custom');
  let matched = false;
  radios.forEach(r => {
    if (r.value === val) { r.checked = true; matched = true; }
  });
  if (!matched && val) {
    radios.forEach(r => { r.checked = false; });
    custom.value = val;
  }
}

/* === HTML 자동입력 === */
async function parseHtml() {
  const html = document.getElementById('html-input').value.trim();
  if (!html) {
    showStatus('parse-status', 'HTML 내용을 붙여넣어 주세요.', 'error');
    return;
  }
  showStatus('parse-status', '분석 중...', '');

  try {
    const res = await fetch('/api/parse-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    });
    const data = await res.json();

    if (data.error) {
      showStatus('parse-status', data.error, 'error');
      return;
    }

    let filled = 0;
    const fieldMap = {
      part: null,  // 특별 처리
      contract_name: 'contract-name',
      contract_date: 'contract-date',
      contract_amount: 'contract-amount',
      supplier: 'supplier',
      current_inspection: 'current-inspection',
      prev_cumulative: 'prev-cumulative',
      cumulative_inspection: 'cumulative-inspection',
      remaining_amount: 'remaining-amount',
      inspection_result: 'inspection-result',
      liquidated_damages: 'liquidated-damages',
    };

    for (const [key, elId] of Object.entries(fieldMap)) {
      if (data[key]) {
        if (key === 'part') {
          setPartValue(data[key]);
          filled++;
        } else if (elId) {
          const el = document.getElementById(elId);
          if (el && !el.value) {
            el.value = data[key];
            filled++;
          }
        }
      }
    }

    // 계약번호 동기화
    const cn = document.getElementById('contract-number').value;
    document.getElementById('insp-contract-number').value = cn;
    document.getElementById('other-contract-number').value = cn;

    showStatus('parse-status',
      filled > 0
        ? `${filled}개 항목이 자동 입력되었습니다. 내용을 확인하고 수정하세요.`
        : 'HTML에서 항목을 찾지 못했습니다. 수동으로 입력해 주세요.',
      filled > 0 ? 'success' : 'error'
    );
  } catch (e) {
    showStatus('parse-status', '오류가 발생했습니다: ' + e.message, 'error');
  }
}

function clearHtmlInput() {
  document.getElementById('html-input').value = '';
  document.getElementById('parse-status').className = 'status-msg hidden';
}

/* === 파일 업로드 === */
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    handleFiles(input.files);
    input.value = '';
  });
}

async function handleFiles(files) {
  for (const file of files) {
    await uploadFile(file);
  }
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload-file', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { showToast('업로드 실패: ' + data.error); return; }

    const type = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
    state.uploadedFiles.push({ filename: data.filename, original: data.original, type });
    renderFileList();
    addViewerOption(data.filename, data.original);
    showToast(`'${data.original}' 업로드 완료`);
  } catch (e) {
    showToast('업로드 오류: ' + e.message);
  }
}

function renderFileList() {
  const container = document.getElementById('file-list');
  container.innerHTML = '';
  state.uploadedFiles.forEach((f, i) => {
    const icon = f.type === 'pdf' ? '📄' : '🖼️';
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${f.original}">${f.original}</span>
      <button class="btn-view" onclick="viewFile('${f.filename}', '${f.type}')">보기</button>
      <button class="btn-remove" title="삭제" onclick="removeFile(${i})">×</button>
    `;
    container.appendChild(item);
  });
}

async function removeFile(index) {
  const f = state.uploadedFiles[index];
  try {
    await fetch('/api/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: f.filename }),
    });
  } catch (e) { /* ignore */ }

  state.uploadedFiles.splice(index, 1);
  renderFileList();
  rebuildViewerSelect();
}

function addViewerOption(filename, original) {
  const sel = document.getElementById('viewer-select');
  const opt = document.createElement('option');
  opt.value = filename;
  opt.textContent = original.length > 28 ? original.slice(0, 28) + '…' : original;
  sel.appendChild(opt);
  // 자동 선택
  sel.value = filename;
  viewFile(filename, filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
}

function rebuildViewerSelect() {
  const sel = document.getElementById('viewer-select');
  sel.innerHTML = '<option value="">-- 첨부파일 선택 --</option>';
  state.uploadedFiles.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.filename;
    const name = f.original;
    opt.textContent = name.length > 28 ? name.slice(0, 28) + '…' : name;
    sel.appendChild(opt);
  });
  document.getElementById('viewer-body').innerHTML =
    '<div class="viewer-placeholder"><p>파일을 선택하세요.</p></div>';
}

function switchViewer(filename) {
  if (!filename) {
    document.getElementById('viewer-body').innerHTML =
      '<div class="viewer-placeholder"><p>파일을 선택하세요.</p></div>';
    return;
  }
  const f = state.uploadedFiles.find(x => x.filename === filename);
  if (f) viewFile(f.filename, f.type);
}

function viewFile(filename, type) {
  const body = document.getElementById('viewer-body');
  const url = `/uploads/${encodeURIComponent(filename)}`;
  if (type === 'pdf') {
    body.innerHTML = `<iframe src="${url}" title="PDF 뷰어"></iframe>`;
  } else {
    body.innerHTML = `<img src="${url}" alt="첨부이미지" />`;
  }
  // select 동기화
  document.getElementById('viewer-select').value = filename;
}

/* === 결재문 생성 === */
async function generateDocument() {
  const data = collectFormData();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();

    const out = document.getElementById('output-area');
    out.textContent = result.output;
    document.getElementById('copy-btn').disabled = false;
    showToast('결재문이 생성되었습니다. 복사 버튼을 누르세요.');

    // 결과 영역으로 스크롤 (모바일)
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    showToast('생성 오류: ' + e.message);
  }
}

function collectFormData() {
  return {
    part: getPartValue(),
    contract_name: v('contract-name'),
    contract_number: v('contract-number'),
    contract_date: v('contract-date'),
    contract_amount: v('contract-amount'),
    supplier: v('supplier'),
    delivery_date: v('delivery-date'),
    inspection_date: v('inspection-date'),
    prev_cumulative: v('prev-cumulative'),
    current_inspection: v('current-inspection'),
    cumulative_inspection: v('cumulative-inspection'),
    remaining_amount: v('remaining-amount'),
    inspection_result: v('inspection-result'),
    warranty_deposit: v('warranty-deposit'),
    warranty_period: v('warranty-period'),
    liquidated_damages: v('liquidated-damages'),
    delay_reason: v('delay-reason'),
    attachments: state.uploadedFiles.map(f => f.original),
  };
}

function v(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

/* === 복사 === */
function copyOutput() {
  const text = document.getElementById('output-area').textContent;
  if (!text || text.includes('결재문 생성 버튼')) return;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('클립보드에 복사되었습니다!'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('클립보드에 복사되었습니다!');
  }
}

/* === 전체 초기화 === */
function resetAll() {
  if (!confirm('모든 입력 내용을 초기화하시겠습니까?')) return;

  const ids = [
    'contract-name', 'contract-number', 'contract-date', 'contract-amount', 'supplier',
    'delivery-date', 'inspection-date', 'prev-cumulative', 'current-inspection',
    'cumulative-inspection', 'remaining-amount', 'inspection-result',
    'warranty-deposit', 'warranty-period', 'liquidated-damages', 'delay-reason',
    'insp-contract-number', 'other-contract-number', 'part-custom', 'html-input',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.querySelectorAll('input[name="part"]').forEach(r => { r.checked = false; });

  document.getElementById('output-area').textContent = '결재문 생성 버튼을 누르면 여기에 결과가 표시됩니다.';
  document.getElementById('copy-btn').disabled = true;
  document.getElementById('parse-status').className = 'status-msg hidden';

  showToast('초기화되었습니다.');
}

/* === 유틸 === */
function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.add('hidden'); }, 2500);
}
