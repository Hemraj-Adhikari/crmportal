/* ═══════════════════════════════════════════════════════
   R2U CRM — CORE LOGIC ADDITIONS
   Yo file ko sabai content `script.js` ko TALA (end ma) paste garnus
   (firebase-auth.js, firebase-updates.js pahile load bhaisakeko huncha)
═══════════════════════════════════════════════════════ */

/* ═══════════ CLOUDINARY CONFIG ═══════════ */
const CLOUDINARY_CLOUD_NAME = 'dv9emyzlg';
const CLOUDINARY_UPLOAD_PRESET = 'fdtrmpus';

let asSelectedFiles = []; // Add Student modal ma select bhayeko files

/* ═══════════════════════════════════════════════════════
   NAVIGATION / VIEW SWITCHING
═══════════════════════════════════════════════════════ */
let currentView = 'students';

function switchView(viewName, linkEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewName);
  if (target) target.classList.add('active');

  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');

  currentView = viewName;

  const titles = {
    students: ['Students', 'All enrolled students across the pipeline'],
    partners: ['Channel Partners', 'Referral agents and partner agencies'],
    universities: ['Partner Universities', 'Sep 2026 intake — courses, entry criteria & fees'],
    followup: ['Daily Follow-Up', 'Students requiring calls and actions today'],
    casshield: ['CAS Shield', 'Pre-CAS readiness checks for all applicants'],
    feedback: ['Mock Pre-CAS', 'Interview feedback builder'],
    email: ['Direct Email', 'Send messages to students, agents, or staff'],
    reports: ['Reports', 'Pipeline breakdowns and conversion insights'],
    upload: ['Import CSV', 'Upload and sync student records'],
    whatsapp: ['WhatsApp', 'Send WhatsApp messages']
  };
  const t = titles[viewName] || [viewName, ''];
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = t[0];
  if (subEl) subEl.textContent = t[1];

  if (viewName === 'students') {
    filterTableStudents();
    updateStats();
    updateFunnel();
    renderDashboardPartners();
  }
}

function goHome() {
  const link = document.querySelector('.sb-link[data-view="students"]');
  switchView('students', link);
}

function backToDashboard() {
  const link = document.querySelector('.sb-link[data-view="students"]');
  switchView('students', link);
}

function toggleGroup(groupId) {
  const grp = document.getElementById(groupId);
  if (grp) grp.classList.toggle('collapsed');
}

function refreshView() {
  loadStudentsFromFirebase();
  toast('Refreshing…', 'info');
}

/* ═══════════════════════════════════════════════════════
   COMMAND PALETTE (basic, optional)
═══════════════════════════════════════════════════════ */
function openCmd() {
  const el = document.getElementById('cmd-overlay');
  if (el) { el.classList.add('open'); document.getElementById('cmd-input')?.focus(); }
}
function closeCmd() {
  document.getElementById('cmd-overlay')?.classList.remove('open');
}
function cmdNav(view) {
  closeCmd();
  const link = document.querySelector('.sb-link[data-view="' + view + '"]');
  switchView(view, link);
}
function cmdSearch(val) { /* optional: implement later */ }
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
  if (e.key === 'Escape') closeCmd();
});

/* ═══════════════════════════════════════════════════════
   STUDENTS TABLE — FILTER, RENDER
═══════════════════════════════════════════════════════ */
let pillFilterField = '', pillFilterValue = '';
let selectedStudentIds = new Set();

function setPillFilterStudents(field, value, btnEl) {
  pillFilterField = field;
  pillFilterValue = value;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  filterTableStudents();
}

function filterTableStudents() {
  const tbody = document.getElementById('students-page-table-body');
  if (!tbody) return;

  const searchVal = (document.getElementById('students-search-input')?.value || '').toLowerCase();
  let list = window.students || [];

  // Pill filter
  if (pillFilterField === 'visa') {
    list = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  } else if (pillFilterField === 'offer') {
    list = list.filter(s => (s['OFFER STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  } else if (pillFilterField === 'cas') {
    list = list.filter(s => (s['CAS STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  }

  // Search filter
  if (searchVal) {
    list = list.filter(s => {
      const blob = [s['STUDENT ID'], s['STUDENT NAME'], s['COURSE'], s['AGENT'], s['UNIVERSITY']]
        .join(' ').toLowerCase();
      return blob.includes(searchVal);
    });
  }

  const countEl = document.getElementById('students-tbl-count');
  if (countEl) countEl.textContent = list.length + ' records';

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No students found</td></tr>';
  } else {
    tbody.innerHTML = list.map(s => {
      const id = s['STUDENT ID'] || s.id;
      const checked = selectedStudentIds.has(id) ? 'checked' : '';
      const visa = s['VISA STATUS'] || '—';
      const visaClass = visa.toLowerCase() === 'approved' ? 'badge-green'
        : visa.toLowerCase() === 'refused' ? 'badge-red' : 'badge-amber';
      return `<tr>
        <td style="text-align:center"><input type="checkbox" ${checked} onchange="toggleSelectStudent('${id}', this.checked)"></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11.5px">${escapeHtml(id)}</td>
        <td><a onclick="openDetail('${id}')" style="cursor:pointer;font-weight:600;color:var(--text-primary)">${escapeHtml(s['STUDENT NAME'] || '—')}</a></td>
        <td>${escapeHtml(s['COURSE'] || '—')}</td>
        <td>${escapeHtml(s['AGENT'] || '—')}</td>
        <td>${escapeHtml(s['OFFER STATUS'] || s['PRE-SCREENING CALL STATUS'] || '—')}</td>
        <td><span class="badge ${visaClass}">${escapeHtml(visa)}</span></td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${id}')">View</button>
        </td>
      </tr>`;
    }).join('');
  }

  updateBulkBar();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toggleSelectStudent(id, checked) {
  if (checked) selectedStudentIds.add(id); else selectedStudentIds.delete(id);
  updateBulkBar();
}

function toggleSelectAllStudents(checked) {
  const list = window.students || [];
  selectedStudentIds = checked ? new Set(list.map(s => s['STUDENT ID'] || s.id)) : new Set();
  filterTableStudents();
}

function clearStudentSelection() {
  selectedStudentIds = new Set();
  filterTableStudents();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-action-bar');
  const label = document.getElementById('bulk-count-label');
  if (!bar) return;
  if (selectedStudentIds.size > 0) {
    bar.style.display = 'flex';
    if (label) label.textContent = selectedStudentIds.size + ' selected';
  } else {
    bar.style.display = 'none';
  }
}

function bulkEmail() { toast('Bulk email — coming soon', 'info'); }
function bulkStatusUpdate() { toast('Bulk status update — coming soon', 'info'); }

/* ═══════════════════════════════════════════════════════
   DASHBOARD STATS / FUNNEL / DISTRIBUTION
═══════════════════════════════════════════════════════ */
function updateStats() {
  const list = window.students || [];
  const total = list.length;
  const visa = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === 'approved').length;
  const cas = list.filter(s => (s['CAS STATUS'] || '').toLowerCase() === 'pending' || (s['CAS STATUS'] || '').toLowerCase() === 'in progress').length;
  const refused = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === 'refused').length;

  setText('stat-total', total);
  setText('stat-visa', visa);
  setText('stat-cas', cas);
  setText('stat-refused', refused);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function updateFunnel() {
  const list = window.students || [];
  const stages = {
    applied: s => true, // everyone counted as applied
    cond: s => ['Received', 'Offer Received'].includes(s['OFFER STATUS']),
    mock: s => (s['MOCK PRE-CAS'] || '').toLowerCase() === 'done',
    cas: s => ['Pending', 'In Progress'].includes(s['CAS STATUS']),
    visa: s => (s['VISA STATUS'] || '').toLowerCase() === 'approved'
  };
  const counts = {
    applied: list.length,
    cond: list.filter(stages.cond).length,
    mock: list.filter(stages.mock).length,
    cas: list.filter(stages.cas).length,
    visa: list.filter(stages.visa).length
  };

  setText('l-applied', counts.applied);
  setText('l-cond', counts.cond);
  setText('l-mock', counts.mock);
  setText('l-cas', counts.cas);
  setText('l-visa', counts.visa);
  setText('d-center', list.length);
  const labelEl = document.getElementById('pipeline-total-label');
  if (labelEl) labelEl.textContent = list.length + ' students';

  // Pipeline funnel bars (simple horizontal bars)
  const funnelEl = document.getElementById('pipeline-funnel');
  if (funnelEl) {
    const max = Math.max(counts.applied, 1);
    const rows = [
      ['Applied & called', counts.applied, 'var(--navy-600)'],
      ['Conditional offer', counts.cond, 'var(--gold-500)'],
      ['Mock / Pre-CAS', counts.mock, 'var(--violet-500)'],
      ['CAS in progress', counts.cas, '#0EA5E9'],
      ['Visa received', counts.visa, 'var(--emerald-500)']
    ];
    funnelEl.innerHTML = rows.map(([label, val, color]) => {
      const pct = Math.round((val / max) * 100);
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:var(--text-secondary)">${label}</span><span style="font-weight:700">${val}</span>
        </div>
        <div style="background:var(--surface-inset);border-radius:6px;height:8px;overflow:hidden">
          <div style="background:${color};height:100%;width:${pct}%;border-radius:6px"></div>
        </div>
      </div>`;
    }).join('');
  }
}

/* ═══════════════════════════════════════════════════════
   CHANNEL PARTNERS — dashboard mini grid (stub-safe)
═══════════════════════════════════════════════════════ */
async function renderDashboardPartners() {
  const grid = document.getElementById('dashboard-cp-grid');
  if (!grid) return;
  try {
    const snap = await db.collection('channelPartners').limit(6).get();
    if (snap.empty) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No channel partners yet</div>';
      return;
    }
    grid.innerHTML = snap.docs.map(d => {
      const p = d.data();
      return `<div class="card" style="padding:12px"><div style="font-weight:600;font-size:13px">${escapeHtml(p.name || d.id)}</div></div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Could not load partners</div>';
  }
}

/* ═══════════════════════════════════════════════════════
   EXPORT CSV
═══════════════════════════════════════════════════════ */
function exportStudentsCSV() {
  const list = window.students || [];
  if (!list.length) { toast('No students to export', 'error'); return; }
  const csv = Papa.unparse(list);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'students_export_' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════
   ADD STUDENT MODAL — open/close + file handling
═══════════════════════════════════════════════════════ */
function openAddStudent() {
  asSelectedFiles = [];
  renderAsFileList();
  document.getElementById('as-error').style.display = 'none';
  document.getElementById('as-success').style.display = 'none';
  document.getElementById('add-student-overlay').style.display = 'block';
}

function closeAddStudent() {
  document.getElementById('add-student-overlay').style.display = 'none';
  // Clear form fields
  ['as-name','as-id','as-dob','as-nationality','as-mobile','as-email',
   'as-level','as-course','as-university','as-agent','as-submitted-by','as-notes']
   .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  asSelectedFiles = [];
  renderAsFileList();
}

function asHandleDrop(event) {
  event.preventDefault();
  event.currentTarget.style.borderColor = '';
  event.currentTarget.style.background = '';
  asHandleFiles(event.dataTransfer.files);
}

function asHandleFiles(fileList) {
  asSelectedFiles = asSelectedFiles.concat(Array.from(fileList));
  renderAsFileList();
}

function asRemoveFile(idx) {
  asSelectedFiles.splice(idx, 1);
  renderAsFileList();
}

function renderAsFileList() {
  const wrap = document.getElementById('as-file-list');
  const itemsEl = document.getElementById('as-file-items');
  if (!wrap || !itemsEl) return;
  if (!asSelectedFiles.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  itemsEl.innerHTML = asSelectedFiles.map((f, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface-inset);border-radius:var(--r-sm);margin-bottom:5px;font-size:12px">
      <span>${escapeHtml(f.name)} <span style="color:var(--text-muted)">(${Math.round(f.size/1024)} KB)</span></span>
      <button onclick="asRemoveFile(${i})" style="background:none;border:none;color:var(--crimson-500);cursor:pointer;font-size:14px">✕</button>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   CLOUDINARY UPLOAD HELPER
═══════════════════════════════════════════════════════ */
async function uploadFileToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'r2u-students');

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Upload failed for ' + file.name);
  const data = await res.json();
  return { name: file.name, url: data.secure_url, type: file.type, uploadedAt: new Date().toISOString() };
}

async function uploadAllAsFiles() {
  const uploaded = [];
  for (const file of asSelectedFiles) {
    const result = await uploadFileToCloudinary(file);
    uploaded.push(result);
  }
  return uploaded;
}

/* ═══════════════════════════════════════════════════════
   STUDENT DETAIL VIEW (basic)
═══════════════════════════════════════════════════════ */
let detailStudentId = null;

function openDetail(studentId) {
  const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === studentId);
  if (!s) { toast('Student not found', 'error'); return; }
  detailStudentId = studentId;

  switchView('student-detail', null);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-student-detail').classList.add('active');

  setText('detail-name', s['STUDENT NAME'] || '—');
  setText('detail-id', s['STUDENT ID'] || studentId);
  setText('detail-level', s['LEVEL'] || '—');
  setText('detail-course', s['COURSE'] || '—');
  setText('detail-breadcrumb-name', s['STUDENT NAME'] || '—');
  setText('dp-sid', s['STUDENT ID'] || studentId);
  setText('dp-level', s['LEVEL'] || '—');
  setText('dp-sname', s['STUDENT NAME'] || '—');
  setText('dp-course', s['COURSE'] || '—');
  setText('dp-dob', s['DOB'] || '—');
  setText('dp-agent', s['AGENT'] || '—');
  setText('dp-mobile-ro', s['MOBILE'] || '—');
  setText('dp-email-ro', s['EMAIL'] || '—');

  const avatarEl = document.getElementById('detail-avatar');
  if (avatarEl) {
    const ini = (s['STUDENT NAME'] || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    avatarEl.textContent = ini;
  }

  const docsSection = document.getElementById('dp-docs-section');
  if (docsSection) {
    const docs = s.documents || [];
    if (!docs.length) {
      docsSection.innerHTML = 'No documents uploaded yet.';
    } else {
      docsSection.innerHTML = docs.map(d =>
        `<a href="${d.url}" target="_blank" style="display:block;margin-bottom:6px;color:var(--navy-600)">${escapeHtml(d.name)}</a>`
      ).join('');
    }
  }
}

/* ═══════════════════════════════════════════════════════
   DRAWER HELPERS (generic open/close used across views)
═══════════════════════════════════════════════════════ */
function closeDrawer(id) {
  document.getElementById(id)?.classList.remove('open');
  document.getElementById('drawer-overlay')?.classList.remove('open');
}
function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
  document.getElementById('drawer-overlay')?.classList.remove('open');
}
function openDrawerEl(id) {
  document.getElementById(id)?.classList.add('open');
  document.getElementById('drawer-overlay')?.classList.add('open');
}

let activeStudentId = null;
let stageEdits = {};
function openStageDrawer(studentId) {
  activeStudentId = studentId;
  stageEdits = {};
  openDrawerEl('drw-stage');
}

console.log('[script-additions.js] loaded ✅');
