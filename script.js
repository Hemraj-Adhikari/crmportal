/* ═══════════════════════════════════════════════════════
   R2U CRM — CORE LOGIC ADDITIONS  (RBAC UPDATED)
   Paste this whole file at the BOTTOM of your script.js
   (firebase-auth.js MUST be loaded BEFORE this file —
   checkAccess(), guardView(), window.staff aaunu firebase-auth.js bata)

   NOTE: Cloudinary config, asSelectedFiles, upload functions,
   file drop/list handlers, and openAddStudent()/closeAddStudent()
   have been moved to firebase-updates.js — they are NOT here
   anymore to avoid duplicate declarations.

   RBAC NOTE: loadStudentsFromFirebase() yahaan define vayeko xa.
   Tapaiko firebase-updates.js maa yo function ALREADY DEFINED
   bhayeko xa bhane, tyo file bata HATAUNU PARXA (delete garnu),
   nabhae duplicate function le purano (unscoped) version le
   override garera RBAC kaam nagarna sakxa.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   NAVIGATION / VIEW SWITCHING  (RBAC GUARDED)
═══════════════════════════════════════════════════════ */
let currentView = 'students';

// Kun view lai kun role(s) le matra herna milxa.
// List bhitra nabhayeko view chai sabai logged-in role lai khula huncha.
const VIEW_PERMISSIONS = {
  upload       : ['Super Admin', 'Admin'],                                   // Import CSV
  reports      : ['Super Admin', 'Admin', 'Document Officer'],
  partners     : ['Super Admin', 'Admin', 'Document Officer'],               // Channel partner ko master list
  casshield    : ['Super Admin', 'Admin', 'Document Officer'],
  feedback     : ['Super Admin', 'Admin', 'Document Officer'],
  email        : ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  whatsapp     : ['Super Admin', 'Admin', 'Document Officer', 'Application User']
  // students, universities, followup -> sabai role lai khula (list ma chaina)
};

function switchView(viewName, linkEl) {
  // RBAC check — permission nabhae view change nai nagarne
  if (VIEW_PERMISSIONS[viewName] && !guardView(viewName, VIEW_PERMISSIONS[viewName])) {
    return;
  }

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

  if (viewName === 'universities') {
    if (!UNI_DATA_LOADED) {
      loadUniversitiesData();
    } else if (typeof renderUniGrid === 'function') {
      renderUniGrid();
    }
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
   STUDENTS — LOAD FROM FIREBASE  (RBAC SCOPED)
   Role anusar Firestore query nai farak huncha:
     - Channel Partner -> .where('partnerId','==', window.staff.partnerId)
     - Document Officer -> example stage filter (comment garyera rakheko)
     - Baaki sabai (Super Admin / Admin / Application User) -> full list
═══════════════════════════════════════════════════════ */
async function loadStudentsFromFirebase() {
  try {
    let query = db.collection('students');

    const role      = window.staff?.role;
    const partnerId = window.staff?.partnerId;

    if (role === 'Channel Partner') {
      if (!partnerId) {
        console.error('[loadStudentsFromFirebase] Channel Partner ko partnerId set xaina — unscoped data load garna mana garyo.');
        window.students = [];
        if (typeof toast === 'function') toast('Tapaiko account ma Partner ID xaina. Admin lai sampark garnu.', 'error');
        filterTableStudents();
        updateStats();
        updateFunnel();
        return;
      }
      query = query.where('partnerId', '==', partnerId);
    }

    // Document Officer le example ma CAS/visa stage ma matra herna sakxa.
    // Chahiyena bhane yo block hataun.
    // if (role === 'Document Officer') {
    //   query = query.where('CAS STATUS', 'in', ['Pending', 'In Progress', 'Issued']);
    // }

    const snap = await query.get();
    window.students = snap.docs.map(d => {
      const data = d.data();
      if (!data['STUDENT ID']) data['STUDENT ID'] = d.id;
      data.id = d.id;
      return data;
    });

    console.log('[loadStudentsFromFirebase] Loaded', window.students.length, 'students for role:', role);

    filterTableStudents();
    updateStats();
    updateFunnel();
  } catch (e) {
    console.error('[loadStudentsFromFirebase] Failed:', e);
    if (typeof toast === 'function') toast('Could not load student data', 'error');
    window.students = [];
    filterTableStudents();
  }
}

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

  if (pillFilterField === 'visa') {
    list = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  } else if (pillFilterField === 'offer') {
    list = list.filter(s => (s['OFFER STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  } else if (pillFilterField === 'cas') {
    list = list.filter(s => (s['CAS STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase());
  }

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

function bulkEmail() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast("Tapaisanga bulk email garne permission chaina", 'error');
    return;
  }
  toast('Bulk email — coming soon', 'info');
}
function bulkStatusUpdate() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast("Tapaisanga status update garne permission chaina", 'error');
    return;
  }
  toast('Bulk status update — coming soon', 'info');
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD STATS / FUNNEL / DISTRIBUTION
   (window.students already RBAC-scoped from loadStudentsFromFirebase)
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
    applied: s => true,
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
   CHANNEL PARTNERS — dashboard mini grid (RBAC-aware)
   Channel Partner role le aaphno partner card matra dekhne.
═══════════════════════════════════════════════════════ */
async function renderDashboardPartners() {
  const grid = document.getElementById('dashboard-cp-grid');
  if (!grid) return;
  try {
    let query = db.collection('channelPartners').limit(6);

    if (window.staff?.role === 'Channel Partner' && window.staff?.partnerId) {
      query = db.collection('channelPartners')
                .where(firebase.firestore.FieldPath.documentId(), '==', window.staff.partnerId);
    }

    const snap = await query.get();
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
   EXPORT CSV  (RBAC — Channel Partner lai export band)
═══════════════════════════════════════════════════════ */
function exportStudentsCSV() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast("Tapaisanga export garne permission chaina", 'error');
    return;
  }
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
   STUDENT DETAIL VIEW (basic)
═══════════════════════════════════════════════════════ */
let detailStudentId = null;

function openDetail(studentId) {
  const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === studentId);
  if (!s) { toast('Student not found', 'error'); return; }
  detailStudentId = studentId;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-student-detail').classList.add('active');
  currentView = 'student-detail';

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
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast("Tapaisanga stage update garne permission chaina", 'error');
    return;
  }
  activeStudentId = studentId;
  stageEdits = {};
  openDrawerEl('drw-stage');
}

/* ═══════════════════════════════════════════════════════
   PARTNER UNIVERSITIES — JSON LOADER
═══════════════════════════════════════════════════════ */
let UNI_DATA = {};
let UNI_DATA_LOADED = false;

async function loadUniversitiesData() {
  try {
    const res = await fetch('universities.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    UNI_DATA = await res.json();
    UNI_DATA_LOADED = true;
    console.log('[Universities] Loaded from universities.json:', Object.keys(UNI_DATA).length, 'universities');
  } catch (e) {
    console.error('[Universities] fetch failed, trying inline fallback:', e);
    const inline = document.getElementById('uni-rawdata');
    if (inline) {
      try {
        UNI_DATA = JSON.parse(inline.textContent);
        UNI_DATA_LOADED = true;
        console.log('[Universities] Loaded from inline fallback');
      } catch (parseErr) {
        console.error('[Universities] Inline fallback parse failed:', parseErr);
        if (typeof toast === 'function') toast('Could not load university data', 'error');
      }
    } else {
      if (typeof toast === 'function') toast('Could not load universities.json — check the file exists next to index.html', 'error');
    }
  }

  setText('uni-total-count', Object.keys(UNI_DATA).length);

  if (currentView === 'universities' && typeof renderUniGrid === 'function') {
    renderUniGrid();
  }
}

document.addEventListener('DOMContentLoaded', loadUniversitiesData);

/* ═══════════════════════════════════════════════════════
   SAFE TOAST FALLBACK
═══════════════════════════════════════════════════════ */
if (typeof toast !== 'function') {
  window.toast = function (msg, type = 'success') {
    console.log('[toast:' + type + ']', msg);
  };
}

console.log('[script-additions.js] loaded  (RBAC view-guard + scoped loadStudentsFromFirebase included)');

/* ═══════════════════════════════════════════════════════
   PIPELINE STAGES & UNIVERSITIES — detail render logic
═══════════════════════════════════════════════════════ */

const STAGE_DEFS = [
  {id:'app_submitted',label:'Application submitted',key:'APPLICATION SUBMITTED DATE',done:s=>!!(s['APPLICATION SUBMITTED DATE']),prevDone:s=>true,type:'date',desc:'Record the date the application was submitted to the university.'},
  {id:'prescreening',label:'Pre-screening call',key:'PRE-SCREENING CALL STATUS',done:s=>/received|no connectivity|on hold|scheduled|withdrew|interested/i.test(s['PRE-SCREENING CALL STATUS']||''),prevDone:s=>!!(s['APPLICATION SUBMITTED DATE']),type:'select',options:[{val:'Received',icon:''},{val:'No Connectivity',icon:''},{val:'On Hold',icon:'⏸'},{val:'Scheduled',icon:''},{val:'Withdrew',icon:''},{val:'Called – Interested',icon:''},{val:'Called – Not Interested',icon:''}],desc:'Log the outcome of the initial pre-screening call with the student.'},
  {id:'offer',label:'Offer received',key:'OFFER STATUS',done:s=>/conditional|unconditional|received/i.test(s['OFFER STATUS']||''),prevDone:s=>!!(s['PRE-SCREENING CALL STATUS']),type:'select',options:[{val:'Conditional',icon:''},{val:'Unconditional',icon:''},{val:'Received',icon:''},{val:'Pending',icon:''},{val:'Rejected',icon:''}],desc:'Update the offer status from the university.'},
  {id:'cas_payment',label:'Payment for CAS Shield',key:'CAS PAYMENT STATUS',done:s=>s['CAS PAYMENT STATUS']==='Paid',prevDone:s=>/conditional|unconditional|received/i.test(s['OFFER STATUS']||''),type:'select',options:[{val:'Paid',icon:''},{val:'Unpaid',icon:''}],desc:'Confirm payment has been received for CAS Shield processing.'},
  {id:'mock',label:'Mock interview',key:'MOCK INTERVIEW STATUS',done:s=>s['MOCK INTERVIEW STATUS']==='Stage 4 Done',prevDone:s=>s['CAS PAYMENT STATUS']==='Paid',type:'mock_stages',desc:'Track progress through all 4 mock interview preparation stages.'},
  {id:'precas',label:'Pre-CAS interview',key:'PRE-CAS INTERVIEW',done:s=>s['PRE-CAS INTERVIEW']==='Pass',prevDone:s=>s['MOCK INTERVIEW STATUS']==='Stage 4 Done',type:'select',options:[{val:'Pass',icon:''},{val:'Fail',icon:''}],desc:'Record the result of the Pre-CAS interview. Pass required to proceed.'},
  {id:'cas_requested',label:'CAS requested',key:'CAS REQUESTED STATUS',done:s=>s['CAS REQUESTED STATUS']==='Requested',prevDone:s=>s['PRE-CAS INTERVIEW']==='Pass',type:'select',options:[{val:'Requested',icon:''},{val:'Not Requested',icon:''}],desc:'Confirm that the CAS has been formally requested from the university.'},
  {id:'cas_received',label:'CAS received',key:'CAS STATUS',done:s=>/issued/i.test(s['CAS STATUS']||''),prevDone:s=>s['CAS REQUESTED STATUS']==='Requested',type:'select',options:[{val:'Issued',icon:''},{val:'Pending',icon:''},{val:'Rejected',icon:''}],desc:'Update when the CAS document has been issued by the university.'},
  {id:'visa',label:'Visa status',key:'VISA STATUS',done:s=>/approved/i.test(s['VISA STATUS']||''),prevDone:s=>/issued/i.test(s['CAS STATUS']||''),type:'select',options:[{val:'Approved',icon:'🎉'},{val:'Submitted',icon:''},{val:'Biometrics Booked',icon:''},{val:'Pending',icon:''},{val:'Refused',icon:''},{val:'Withdrawn',icon:''}],desc:"Track the student's visa application status."}
];

const MOCK_STAGES = ['Stage 1 Done','Stage 2 Done','Stage 3 Done','Stage 4 Done'];
const stageList = s => STAGE_DEFS.map(sd => ({label:sd.label, done:!!sd.done(s)}));
const stageCurrent = s => { const l=stageList(s); const i=l.findIndex(x=>!x.done); return i===-1?l.length:i; };
const stageDoneCount = s => STAGE_DEFS.filter(sd=>sd.done(s)).length;

function renderStagePipeline(s) {
  const wrap = document.getElementById('stage-pipeline-content');
  if(!wrap) return;
  wrap.innerHTML = '';
  const pending = {};
  Object.values(stageEdits || {}).forEach(e => { if(e && e.key) pending[e.key] = e.val; });
  const merged = Object.assign({}, s, pending);
  
  STAGE_DEFS.forEach((sd, i) => {
    const isDone = !!sd.done(merged);
    const isPrevDone = !!sd.prevDone(merged);
    const isCurrent = !isDone && isPrevDone;
    const isLocked = !isDone && !isPrevDone;
    const curVal = merged[sd.key] || '';
    const noteKey = sd.key + ' NOTES';
    const noteVal = merged[noteKey] || '';
    
    const step = document.createElement('div');
    step.className = 'stage-step' + (isDone ? ' completed' : isCurrent ? ' current' : isLocked ? ' locked' : '');
    
    let nodeInner = '';
    if(isDone) nodeInner = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    else if(isCurrent) nodeInner = `<span style="font-size:9px;font-weight:700;color:#FFF">${i+1}</span>`;
    else nodeInner = `<span style="font-size:9px;color:var(--text-disabled)">${i+1}</span>`;
    
    let contentHTML = `<div class="stage-title">${sd.label}</div>`;
    if(isDone && curVal) contentHTML += `<div class="stage-current-val">✓ ${curVal}</div>`;
    if(!isDone && !isLocked && curVal) contentHTML += `<div class="stage-current-val">${curVal}</div>`;
    
    if(isLocked) {
      contentHTML += `<div class="stage-locked-msg">Complete "${STAGE_DEFS[i-1]?.label || 'previous stage'}" first to unlock this stage.</div>`;
    } else {
      if(sd.type === 'date') {
        contentHTML += `<div style="margin-top:6px"><input type="date" class="form-control" style="max-width:180px" value="${escapeHtml(curVal)}" data-stage-idx="${i}" data-stage-key="${escapeHtml(sd.key)}" oninput="stageEdits[${i}]={key:'${escapeHtml(sd.key)}',val:this.value}"></div>`;
      } else if(sd.type === 'select') {
        contentHTML += `<div class="stage-options">`;
        sd.options.forEach(opt => {
          const isSel = curVal === opt.val;
          contentHTML += `<div class="stage-opt${isSel ? ' selected' : ''}" onclick="pickStageOpt(this,${i},'${escapeHtml(sd.key)}','${escapeHtml(opt.val)}')"><span class="stage-opt-icon">${opt.icon}</span>${opt.val}</div>`;
        });
        contentHTML += `</div>`;
      } else if(sd.type === 'mock_stages') {
        const curLevel = MOCK_STAGES.indexOf(curVal);
        contentHTML += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${sd.desc}</div><div class="stage-options">`;
        MOCK_STAGES.forEach((ms, mi) => {
          const isSel = curVal === ms;
          const mockUnlocked = mi === 0 || curLevel >= mi-1;
          contentHTML += `<div class="stage-opt${isSel ? ' selected' : ''}${!mockUnlocked ? ' locked-row' : ''}" onclick="pickMockStage(this,${i},'${escapeHtml(ms)}',${mi},${curLevel})" style="${!mockUnlocked ? 'opacity:.4;pointer-events:none' : ''}"><span class="stage-opt-icon">${isSel || curLevel >= mi ? '✅' : '⭕'}</span>Mock ${ms}</div>`;
        });
        contentHTML += `</div>`;
      }
      contentHTML += `<div class="stage-notes"><label>Notes (optional)</label><textarea placeholder="Add notes…" id="stage-note-${i}" data-note-key="${escapeHtml(noteKey)}" oninput="stageEdits['note_${i}']={key:'${escapeHtml(noteKey)}',val:this.value}">${escapeHtml(noteVal)}</textarea></div>`;
    }
    
    step.innerHTML = `<div class="stage-node">${nodeInner}</div><div class="stage-content">${contentHTML}</div>`;
    wrap.appendChild(step);
  });
}

function pickStageOpt(el, idx, key, val) {
  el.closest('.stage-options').querySelectorAll('.stage-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  stageEdits[idx] = {key, val};
}

function pickMockStage(el, idx, val, mi, curLevel) {
  stageEdits[idx] = {key: 'MOCK INTERVIEW STATUS', val};
  const s = window.students.find(s => (s['STUDENT ID'] || s.id) === activeStudentId);
  if(s) renderStagePipeline(s);
}

window.openStageDrawer = function(sid) {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast("Tapaisanga stage update garne permission chaina", 'error');
    return;
  }
  const s = (window.students || []).find(s => (s['STUDENT ID'] || s.id) === sid);
  if(!s) { toast('Student not found', 'error'); return; }
  activeStudentId = sid;
  stageEdits = {};
  const subEl = document.getElementById('drw-stage-sub');
  if(subEl) subEl.textContent = (s['STUDENT NAME'] || 'Unknown') + ' · ' + sid;
  renderStagePipeline(s);
  openDrawerEl('drw-stage');
};

const UNI_COLORS=[
  ['#1E3A5F','#E8C84E'],['#6B3FA0','#F0E6FF'],['#1A5C38','#D1FAE5'],
  ['#7C2D12','#FEE2E2'],['#0C4A6E','#BAE6FD'],['#4C1D95','#EDE9FE'],
  ['#134E4A','#CCFBF1'],['#713F12','#FEF3C7'],['#831843','#FCE7F3'],
  ['#064E3B','#A7F3D0'],['#1E40AF','#DBEAFE'],['#9D174D','#FCE7F3'],
];
function uniColor(idx){ return UNI_COLORS[idx % UNI_COLORS.length]; }

let uniKeys = [];
let currentUniKey = null;
let uniFilter = 'all';
let allCurrentCourses = [];

function renderUniGrid() {
  uniKeys = Object.keys(UNI_DATA || {});
  const q = (document.getElementById('uni-search-input')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('uni-grid');
  if(!grid) return;

  const filtered = uniKeys.filter(k => {
    const u = UNI_DATA[k];
    const matchFilter = uniFilter === 'all' || u.categories.some(c => c.toUpperCase().includes(uniFilter));
    if(!matchFilter) return false;
    if(!q) return true;
    if(u.title.toLowerCase().includes(q)) return true;
    return u.courses.some(c => c.name && c.name.toLowerCase().includes(q));
  });

  const countEl = document.getElementById('uni-total-count');
  if(countEl) countEl.textContent = filtered.length;

  if(!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:40px">No universities found for your search.</div>';
    return;
  }

  grid.innerHTML = filtered.map((k, i) => {
    const u = UNI_DATA[k];
    const [bg, fg] = uniColor(uniKeys.indexOf(k));
    const courseCount = u.courses.filter(c => c.name && !c.section && c.level && !['Level','Course Level','FEE STRUCTURE','SCHOLARSHIP','Intake'].includes(c.level)).length;
    const cats = u.categories.slice(0, 2).map(c => `<span class="badge badge-slate" style="font-size:9px">${escapeHtml(c)}</span>`).join('');
    const initials = k.slice(0, 3);
    const fee = (u.criteria && u.criteria['FEE STRUCTURE'] && u.criteria['FEE STRUCTURE'][0]) || '';
    const feeShort = fee ? fee.split('\n')[0].trim().substring(0, 28) : '—';
    const scholarship = (u.criteria && u.criteria['SCHOLARSHIP'] && u.criteria['SCHOLARSHIP'].find(v => v && v.trim())) || '';
    const scholarshipShort = scholarship ? scholarship.split('\n')[0].trim().substring(0, 28) : '—';
    const firstCourse = u.courses.find(c => c.name && !c.section);
    const intake = (firstCourse && firstCourse.intake) || '—';
    const campus = (firstCourse && firstCourse.campus) || '';

    return `<div class="uni-card" onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">
      <div class="uni-card-band" style="background:linear-gradient(135deg,${bg}14,var(--surface-muted))">
        ${campus ? `<span class="uni-loc-pill"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(campus)}</span>` : ''}
        <div class="uni-card-id" style="background:${bg};color:${fg}">${initials}</div>
        <div class="uni-card-title">${escapeHtml(u.title)}</div>
        <div class="uni-card-cats">${cats}</div>
      </div>
      <div class="uni-bento">
        <div class="uni-bento-tile">
          <div class="uni-bento-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
          <div><div class="uni-bento-label">Fee from</div><div class="uni-bento-val">${escapeHtml(feeShort)}</div></div>
        </div>
        <div class="uni-bento-tile">
          <div class="uni-bento-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></div>
          <div><div class="uni-bento-label">Courses</div><div class="uni-bento-val">${courseCount}</div></div>
        </div>
        <div class="uni-bento-tile">
          <div class="uni-bento-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a4 4 0 100-8 4 4 0 000 8z"/><path d="M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2"/></svg></div>
          <div><div class="uni-bento-label">Scholarship</div><div class="uni-bento-val">${escapeHtml(scholarshipShort)}</div></div>
        </div>
        <div class="uni-bento-tile">
          <div class="uni-bento-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div><div class="uni-bento-label">Intake</div><div class="uni-bento-val">${escapeHtml(intake)}</div></div>
        </div>
      </div>
      <div class="uni-card-actions">
        <button class="btn btn-primary btn-sm uni-act-btn" onclick="openUniDetail('${escapeHtml(k)}')">View details</button>
        <button class="btn btn-gold btn-sm uni-act-btn" onclick="onboardToUniversity('${escapeHtml(k)}')">Onboard students</button>
      </div>
    </div>`;
  }).join('');
}

window.openUniDetail = function(key) {
  currentUniKey = key;
  const u = UNI_DATA[key];
  if(!u) return;

  document.getElementById('uni-list-view').style.display = 'none';
  document.getElementById('uni-detail-view').style.display = 'block';

  const colorIdx = uniKeys.indexOf(key);
  const [bg, fg] = uniColor(colorIdx);
  const initials = key.slice(0, 3);

  document.getElementById('uni-detail-breadcrumb').textContent = u.title;
  document.getElementById('uni-detail-title').textContent = u.title;
  document.getElementById('uni-detail-avatar').textContent = initials;
  document.getElementById('uni-detail-avatar').style.background = bg;
  document.getElementById('uni-detail-avatar').style.color = fg;
  document.getElementById('uni-detail-cats').innerHTML = u.categories.map(c => `<span class="badge badge-slate" style="font-size:9.5px">${escapeHtml(c)}</span>`).join('');

  document.getElementById('uni-prev-btn').disabled = (colorIdx === 0);
  document.getElementById('uni-next-btn').disabled = (colorIdx === uniKeys.length - 1);

  renderUniCriteria(u);

  allCurrentCourses = u.courses.filter(c => c.name && !c.section && c.level && !['Level','Course Level','FEE STRUCTURE','SCHOLARSHIP','Intake'].includes(c.level));
  document.getElementById('uni-course-count').textContent = allCurrentCourses.length;
  populateCourseLevelFilter(allCurrentCourses);
  renderCourseTable(allCurrentCourses);
  showUniDetailTab('criteria');
};

function renderUniCriteria(u) {
  const grid = document.getElementById('uni-criteria-grid');
  const c = u.criteria || {};
  const keys = Object.keys(c);
  
  const criteriaColors = {
    'ACADEMIC CRITERIA':'var(--navy-600)', 'ENGLISH LANGUAGE CRITERIA':'var(--emerald-600)',
    'ENGLISH WAIVER CRITERIA':'var(--violet-600)', 'FEE STRUCTURE':'var(--gold-700)',
    'SCHOLARSHIP':'var(--emerald-700)', 'GAP':'var(--amber-700)',
    'CAS Deposit':'var(--sky-700)', 'Enrollment Fee':'var(--text-secondary)'
  };

  if(!keys.length) { grid.innerHTML = '<div class="empty-state">No criteria data available.</div>'; return; }

  grid.innerHTML = keys.map(label => {
    const vals = c[label];
    if(!vals || !vals.length || vals.every(v => !v)) return '';
    const color = criteriaColors[label] || 'var(--text-primary)';
    const cats = u.categories;
    const rows = vals.map((v, i) => {
      if(!v && v !== 0) return '';
      const cat = cats[i] || '';
      return `<div style="padding:10px 14px;border-bottom:1px solid var(--border-subtle)">
        ${cat ? `<div style="font-size:9px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${escapeHtml(cat)}</div>` : ''}
        <div style="font-size:11.5px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.55">${escapeHtml(v.trim())}</div>
      </div>`;
    }).filter(Boolean).join('');
    if(!rows) return '';
    return `<div class="card" style="padding:0;overflow:hidden">
      <div style="padding:10px 14px;background:var(--surface-inset);border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:7px">
        <div style="width:3px;height:14px;background:${color};border-radius:2px;flex-shrink:0"></div>
        <span style="font-size:10.5px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:.06em">${escapeHtml(label)}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
}

function populateCourseLevelFilter(courses) {
  const sel = document.getElementById('course-level-filter');
  if(!sel) return;
  const levels = [...new Set(courses.map(c => c.level).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All levels</option>' + levels.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
}

function renderCourseTable(courses) {
  const body = document.getElementById('uni-courses-body');
  if(!body) return;
  if(!courses.length) { body.innerHTML = '<tr><td colspan="5" class="empty-state">No courses found.</td></tr>'; return; }
  body.innerHTML = courses.map(c => `<tr>
    <td style="font-weight:500;font-size:12px">${escapeHtml(c.name || '')}</td>
    <td><span class="badge badge-slate" style="font-size:9.5px">${escapeHtml(c.level || '')}</span></td>
    <td style="font-size:11.5px;color:var(--text-muted)">${escapeHtml(c.campus || '—')}</td>
    <td style="font-size:11.5px;color:var(--text-muted)">${escapeHtml(c.intake || '')}</td>
    <td style="font-size:11px;color:var(--amber-700)">${c.extra ? escapeHtml(c.extra) : '—'}</td>
  </tr>`).join('');
}

window.showUniList = function() {
  document.getElementById('uni-list-view').style.display = '';
  document.getElementById('uni-detail-view').style.display = 'none';
  currentUniKey = null;
};

window.uniNavStep = function(dir) {
  if(!currentUniKey) return;
  const idx = uniKeys.indexOf(currentUniKey);
  const next = uniKeys[idx + dir];
  if(next) window.openUniDetail(next);
};

window.showUniDetailTab = function(tab) {
  ['criteria', 'courses'].forEach(t => {
    const panel = document.getElementById('uni-panel-' + t);
    const btn = document.getElementById('udctab-' + t);
    if(panel) panel.style.display = (t === tab ? '' : 'none');
    if(btn) btn.classList.toggle('active', t === tab);
  });
};

window.filterCourses = function() {
  const q = (document.getElementById('course-search-input')?.value || '').toLowerCase();
  const lvl = (document.getElementById('course-level-filter')?.value || '');
  const filtered = allCurrentCourses.filter(c => {
    const matchQ = !q || (c.name || '').toLowerCase().includes(q);
    const matchL = !lvl || c.level === lvl;
    return matchQ && matchL;
  });
  renderCourseTable(filtered);
};

window.filterUniGrid = function() { renderUniGrid(); };
window.setUniFilter = function(f, btn) {
  uniFilter = f;
  document.querySelectorAll('#view-universities .seg-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderUniGrid();
};

window.onboardToUniversity = function(key) {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast("Tapaisanga onboarding garne permission chaina", 'error');
    return;
  }
  const u = UNI_DATA[key];
  if(!u) { toast('University not found', 'error'); return; }
  openAddStudent(u.title);
  toast('Onboarding for ' + u.title, 'info');
};
