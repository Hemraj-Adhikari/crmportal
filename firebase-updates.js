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

   THIS REVISION ADDS:
     - toast() + today() real implementations
     - Login: doLogin / togglePwd / signOut / checkAccess /
       guardView / bootSession are NOT redefined here — they
       live in firebase-auth.js (real Firebase Auth + 'users'
       collection RBAC) and that file loads first. We only
       wrap bootSession() to bolt on our own post-login setup
       (partners grid, universities, chat listener).
     - Channel Partners: full grid + Add Partner modal-ish flow
       (collection 'channelPartners', fields: name, type, email,
       phone, studentsCount)
     - Notify drawer (Send Notification) — uses EmailJS
     - Email page (Direct Email) — uses EmailJS
     - Mock Pre-CAS / Feedback builder (drawer + full page)
     - CAS Shield table + update drawer
     - Internal Chat — collection 'chatMessages' with fields
       {group, senderName, senderRole, text, createdAt}
     - Reports page
     - Channel Partner restricted view (Universities + own
       students only) + Download Template / Bulk Upload with
       auto partnerId attachment
   EmailJS: replace EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID /
   EMAILJS_PUBLIC_KEY below with your real EmailJS values.
   Until then, sends will fail gracefully with a toast.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   CONFIG — EmailJS
═══════════════════════════════════════════════════════ */
const EMAILJS_PUBLIC_KEY  = 'YOUR_EMAILJS_PUBLIC_KEY';
const EMAILJS_SERVICE_ID  = 'YOUR_EMAILJS_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'YOUR_EMAILJS_TEMPLATE_ID';

(function initEmailJS() {
  try {
    if (window.emailjs && EMAILJS_PUBLIC_KEY && EMAILJS_PUBLIC_KEY.indexOf('YOUR_') !== 0) {
      emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }
  } catch (e) { console.warn('[EmailJS] init failed', e); }
})();

async function sendViaEmailJS({ to_email, to_name, subject, message }) {
  if (!window.emailjs) throw new Error('EmailJS SDK not loaded');
  if (EMAILJS_PUBLIC_KEY.indexOf('YOUR_') === 0) {
    throw new Error('EmailJS not configured — set EMAILJS_SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY in script-additions.js');
  }
  return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email, to_name, subject, message,
    from_name: (window.staff && window.staff.name) || 'Route2Uni CRM'
  });
}

/* ═══════════════════════════════════════════════════════
   TOAST / LOADING / MISC HELPERS  (real implementations)
═══════════════════════════════════════════════════════ */
function toast(msg, type) {
  type = type || 'success';
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) { console.log('[toast:' + type + ']', msg); return; }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}
window.toast = toast;

function showLoading(msg) {
  const el = document.getElementById('global-loading');
  const m = document.getElementById('loading-msg');
  if (m) m.textContent = msg || 'Processing…';
  if (el) el.classList.add('show');
}
function hideLoading() {
  document.getElementById('global-loading')?.classList.remove('show');
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowStr() {
  return new Date().toLocaleString();
}

/* ═══════════════════════════════════════════════════════
   LOGIN
   doLogin / togglePwd / signOut / checkAccess / guardView /
   bootSession all live in firebase-auth.js (real Firebase
   Auth + 'users' collection RBAC) and that file loads BEFORE
   this one — so they are intentionally NOT redefined here to
   avoid silently overriding the real implementations.

   To hook our own post-login setup (loading partners,
   universities, and the chat listener) without touching
   firebase-auth.js, we wrap its bootSession() below.
═══════════════════════════════════════════════════════ */
(function wrapBootSession() {
  const tryWrap = () => {
    if (typeof window.bootSession !== 'function' || window.__bootSessionWrapped) return;
    const original = window.bootSession;
    window.bootSession = function (...args) {
      const result = original.apply(this, args);
      // original already calls loadStudentsFromFirebase() itself —
      // we only add the extra views it doesn't know about.
      renderDashboardPartners();
      loadUniversitiesData();
      if (typeof initChatListener === 'function') initChatListener(currentChatGroup || 'global');
      applyChannelPartnerRestrictions();
      return result;
    };
    window.__bootSessionWrapped = true;
  };
  tryWrap();
  document.addEventListener('DOMContentLoaded', tryWrap);
})();

/* ═══════════════════════════════════════════════════════
   NAVIGATION / VIEW SWITCHING  (RBAC GUARDED)
═══════════════════════════════════════════════════════ */
let currentView = 'students';

const VIEW_PERMISSIONS = {
  upload       : ['Super Admin', 'Admin'],
  reports      : ['Super Admin', 'Admin', 'Document Officer'],
  partners     : ['Super Admin', 'Admin', 'Document Officer'],
  casshield    : ['Super Admin', 'Admin', 'Document Officer'],
  feedback     : ['Super Admin', 'Admin', 'Document Officer'],
  email        : ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  whatsapp     : ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  followup     : ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  chat         : ['Super Admin', 'Admin', 'Document Officer', 'Application User']
};

function switchView(viewName, linkEl) {
  // Channel Partner — hard lock to students/universities only, regardless of how navigation was triggered
  if (window.staff?.role === 'Channel Partner' && !['dashboard', 'students', 'universities', 'student-detail'].includes(viewName)) {
    toast('Tapaisanga yo page herne permission chaina', 'error');
    return;
  }

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
    dashboard: ['Dashboard', 'Route2Uni complete live overview'],
    students: ['Students', 'All enrolled students across the pipeline'],
    partners: ['Channel Partners', 'Referral agents and partner agencies'],
    universities: ['Partner Universities', 'Sep 2026 intake — courses, entry criteria & fees'],
    followup: ['Daily Follow-Up', 'Students requiring calls and actions today'],
    casshield: ['CAS Shield', 'Pre-CAS readiness checks for all applicants'],
    feedback: ['Mock Pre-CAS', 'Interview feedback builder'],
    email: ['Direct Email', 'Send messages to students, agents, or staff'],
    reports: ['Reports', 'Pipeline breakdowns and conversion insights'],
    upload: ['Import CSV', 'Upload and sync student records'],
    whatsapp: ['WhatsApp', 'Send WhatsApp messages'],
    chat: ['Internal Chat', 'Team-wide messaging, real-time']
  };
  const t = titles[viewName] || [viewName, ''];
  setText('page-title', t[0]);
  setText('page-subtitle', t[1]);

  if (viewName === 'dashboard') {
    updateStats();
    updateFunnel();
    renderDashboard();
  }
  if (viewName === 'students') {
    filterTableStudents();
    updateStats();
  }
  if (viewName === 'partners') renderPartnersGrid();
  if (viewName === 'followup') renderFollowUp();
  if (viewName === 'casshield') loadCASShield();
  if (viewName === 'feedback') initFeedbackPage();
  if (viewName === 'reports') renderReports();
  if (viewName === 'chat') initChatListener(currentChatGroup);

  if (viewName === 'universities') {
    if (!UNI_DATA_LOADED) {
      loadUniversitiesData();
    } else if (typeof renderUniGrid === 'function') {
      renderUniGrid();
    }
  }
}

function goHome() {
  const link = document.querySelector('.sb-link[data-view="dashboard"]');
  switchView('dashboard', link);
}

function backToDashboard() {
  const link = document.querySelector('.sb-link[data-view="dashboard"]');
  switchView('dashboard', link);
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
  if (e.key === 'Escape') { closeCmd(); closeAllDrawers(); }
});

/* ═══════════════════════════════════════════════════════
   STUDENTS — LOAD FROM FIREBASE
   NOTE: Canonical reactive (onSnapshot) implementation lives in
   firebase-updates.js. Do not redefine here — this used to be a
   duplicate one-shot .get() that silently overwrote the live
   listener on every script-additions.js load.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   STUDENTS TABLE — FILTER, RENDER
═══════════════════════════════════════════════════════ */
let pillFilterField = '', pillFilterValue = '';
let selectedStudentIds = new Set();

function setPillFilterStudents(field, value, btnEl) {
  pillFilterField = field;
  pillFilterValue = value;
  document.querySelectorAll('#view-students .seg-btn').forEach(b => b.classList.remove('active'));
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
        <td style="text-align:center">
          <button class="btn btn-ghost btn-sm" onclick="openStageDrawer('${id}')" title="Edit" style="padding:3px 7px">✏️</button>
        </td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11.5px">${escapeHtml(id)}</td>
        <td><a onclick="openDetail('${id}')" style="cursor:pointer;font-weight:600;color:var(--text-primary)">${escapeHtml(s['STUDENT NAME'] || '—')}</a></td>
        <td>${escapeHtml(s['COURSE'] || '—')}</td>
        <td>${escapeHtml(s['AGENT'] || '—')}</td>
        <td>${escapeHtml(s['OFFER STATUS'] || s['PRE-SCREENING CALL STATUS'] || '—')}</td>
        <td><span class="badge ${visaClass}">${escapeHtml(visa)}</span></td>
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

function selectedStudentsList() {
  const list = window.students || [];
  return list.filter(s => selectedStudentIds.has(s['STUDENT ID'] || s.id));
}

async function bulkEmail() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast('Tapaisanga bulk email garne permission chaina', 'error');
    return;
  }
  const list = selectedStudentsList();
  if (!list.length) { toast('No students selected', 'error'); return; }
  const withEmail = list.filter(s => s['EMAIL']);
  if (!withEmail.length) { toast('Selected students have no email on file', 'error'); return; }

  showLoading('Sending ' + withEmail.length + ' emails…');
  let ok = 0, fail = 0;
  for (const s of withEmail) {
    try {
      await sendViaEmailJS({
        to_email: s['EMAIL'],
        to_name: s['STUDENT NAME'] || '',
        subject: 'Update from Route2Uni',
        message: 'Hi ' + (s['STUDENT NAME'] || '') + ', this is a bulk update from your Route2Uni team.'
      });
      ok++;
    } catch (e) { fail++; }
  }
  hideLoading();
  toast(`Sent ${ok}, failed ${fail}`, fail ? 'error' : 'success');
  clearStudentSelection();
}

function bulkWhatsApp() {
  const list = selectedStudentsList();
  if (!list.length) { toast('No students selected', 'error'); return; }
  toast('Bulk WhatsApp — opening WhatsApp Web for ' + list.length + ' students is not yet wired to an API. Use individual WhatsApp links from student detail for now.', 'info');
}

function bulkStatusUpdate() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast('Tapaisanga status update garne permission chaina', 'error');
    return;
  }
  const list = selectedStudentsList();
  if (!list.length) { toast('No students selected', 'error'); return; }
  toast('Bulk status update for ' + list.length + ' students — open each record and use "Update pipeline" for now.', 'info');
}

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
   DASHBOARD — top-level real-time reactive overview
   Pulls from window.students (onSnapshot) and
   window.channelPartners (onSnapshot) — no extra reads.
═══════════════════════════════════════════════════════ */
function renderDashboard() {
  const list = window.students || [];

  setText('kpi-total', list.length);
  setText('kpi-visa', list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === 'approved').length);
  setText('kpi-cas', list.filter(s => ['Pending', 'In Progress'].includes(s['CAS STATUS'])).length);
  setText('kpi-refused', list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === 'refused').length);
  setText('kpi-offers', list.filter(s => ['Received', 'Offer Received'].includes(s['OFFER STATUS'])).length);
  setText('kpi-partners', (window.channelPartners || []).length);

  renderEnrollmentTrendChart(list);
  renderDashboardPartners();
}

function renderEnrollmentTrendChart(list) {
  const el = document.getElementById('dash-enrollment-chart');
  if (!el) return;

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleString('en', { month: 'short' }), count: 0 });
  }
  list.forEach(s => {
    const raw = s['createdAt'];
    let d = null;
    if (raw && typeof raw.toDate === 'function') d = raw.toDate();
    else if (raw) d = new Date(raw);
    if (!d || isNaN(d)) return;
    const key = d.getFullYear() + '-' + d.getMonth();
    const m = months.find(m => m.key === key);
    if (m) m.count++;
  });

  const max = Math.max(...months.map(m => m.count), 1);
  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding:0 4px">
    ${months.map(m => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
        <div style="font-size:10.5px;font-weight:700;color:var(--text-primary)">${m.count}</div>
        <div style="width:100%;max-width:34px;background:linear-gradient(180deg,var(--navy-600),var(--navy-800));border-radius:5px 5px 2px 2px;height:${Math.max(6, Math.round((m.count / max) * 100))}px;transition:height .6s ease"></div>
        <div style="font-size:10px;color:var(--text-muted)">${m.label}</div>
      </div>`).join('')}
  </div>`;
}



function renderDashboardPartners() {
  const grid = document.getElementById('dashboard-cp-grid');
  if (!grid) return;
  if (window.staff?.role === 'Channel Partner') return;

  const partners = window.channelPartners || [];
  if (!partners.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No channel partners yet</div>';
    return;
  }
  grid.innerHTML = partners.slice(0, 6).map(p => partnerCardHTML(p.id, p)).join('');
}

function partnerInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
const PARTNER_COLORS = ['#1E3A5F', '#6B3FA0', '#1A5C38', '#7C2D12', '#0C4A6E', '#4C1D95', '#134E4A', '#713F12'];
function partnerColor(seedStr) {
  let h = 0;
  for (let i = 0; i < (seedStr || '').length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return PARTNER_COLORS[h % PARTNER_COLORS.length];
}

function partnerCardHTML(id, p) {
  const color = partnerColor(p.name || id);
  return `<div class="cp-card">
    <div class="cp-card-head">
      <div class="cp-avatar" style="background:${color}">${partnerInitials(p.name)}</div>
      <div>
        <div class="cp-name">${escapeHtml(p.name || id)}</div>
        <div class="cp-type">${escapeHtml(p.type || 'Agent')}</div>
      </div>
    </div>
    <div class="cp-stats">
      <div><div class="cp-stat-val">${p.studentsCount ?? 0}</div><div class="cp-stat-label">Students</div></div>
      <div><div class="cp-stat-val" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.email || '—')}</div><div class="cp-stat-label">Email</div></div>
      <div><div class="cp-stat-val" style="font-size:12px">${escapeHtml(p.phone || '—')}</div><div class="cp-stat-label">Phone</div></div>
    </div>
  </div>`;
}

function renderPartnersGrid() {
  const grid = document.getElementById('full-cp-grid');
  if (!grid) return;
  const partners = window.channelPartners || [];
  if (!partners.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No channel partners yet — click "Add partner" to create one.</div>';
    return;
  }
  grid.innerHTML = partners.map(p => partnerCardHTML(p.id, p)).join('');
}

function openAddPartner() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast('Tapaisanga partner add garne permission chaina', 'error');
    return;
  }
  const name = prompt('Partner / agency name:');
  if (!name) return;
  const type = prompt('Type (e.g. Sub-agent, Direct, Education Consultancy):', 'Sub-agent') || 'Sub-agent';
  const email = prompt('Contact email (optional):', '') || '';
  const phone = prompt('Contact phone (optional):', '') || '';

  showLoading('Adding partner…');
  db.collection('channelPartners').add({
    name, type, email, phone, studentsCount: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    hideLoading();
    toast('Partner added', 'success');
    renderPartnersGrid();
    renderDashboardPartners();
  }).catch(e => {
    hideLoading();
    console.error('[openAddPartner]', e);
    toast('Could not add partner', 'error');
  });
}

/* ═══════════════════════════════════════════════════════
   EXPORT CSV  (RBAC — Channel Partner lai export band)
═══════════════════════════════════════════════════════ */
function exportStudentsCSV() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast('Tapaisanga export garne permission chaina', 'error');
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
  if (avatarEl) avatarEl.textContent = partnerInitials(s['STUDENT NAME']);

  const docsSection = document.getElementById('dp-docs-section');
  if (docsSection) {
    const docs = s.documents || [];
    docsSection.innerHTML = !docs.length ? 'No documents uploaded yet.' :
      docs.map(d => `<a href="${d.url}" target="_blank" style="display:block;margin-bottom:6px;color:var(--navy-600)">${escapeHtml(d.name)}</a>`).join('');
  }

  setText('dp-pipeline-score', stageDoneCount(s) + '/' + STAGE_DEFS.length);
  const pipelineList = document.getElementById('dp-pipeline-list');
  if (pipelineList) {
    pipelineList.innerHTML = stageList(s).map((st, i) => `
      <div class="stage-row${!st.done && stageCurrent(s) < i ? ' locked-row' : ''}">
        <div class="stage-left">
          <span class="stage-num">${i + 1}</span>
          <span class="stage-check${st.done ? ' done' : ''}">${st.done ? '✓' : ''}</span>
          <span class="stage-name">${escapeHtml(st.label)}</span>
        </div>
      </div>`).join('');
  }
  const summary = document.getElementById('dp-stage-summary');
  if (summary) {
    summary.innerHTML = STAGE_DEFS.map(sd => {
      const val = s[sd.key] || '—';
      return `<div class="detail-field-row" style="grid-template-columns:1fr"><span class="detail-field-label">${escapeHtml(sd.label)}</span><span class="detail-field-val">${escapeHtml(val)}</span></div>`;
    }).join('');
  }
}

function openNotifyFromDetail() {
  if (!detailStudentId) return;
  const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === detailStudentId);
  if (!s) return;
  notifyTargetStudent = s;
  setText('drw-notify-sub', (s['STUDENT NAME'] || '—') + ' · ' + detailStudentId);
  document.getElementById('notify-role').value = 'Student';
  notifyPreviewRecip();
  openDrawerEl('drw-notify');
}

function openFeedbackFromDetail() {
  if (!detailStudentId) return;
  const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === detailStudentId);
  if (!s) return;
  setText('drw-fb-sub', (s['STUDENT NAME'] || '—') + ' · ' + detailStudentId);
  document.getElementById('drw-fb-date').value = today();
  drwFeedbackTarget = s;
  openDrawerEl('drw-feedback');
}

/* ═══════════════════════════════════════════════════════
   NOTIFY DRAWER (uses EmailJS)
═══════════════════════════════════════════════════════ */
let notifyTargetStudent = null;

function notifyPreviewRecip() {
  const role = document.getElementById('notify-role')?.value;
  const txt = document.getElementById('notify-recip-text');
  if (!txt) return;
  if (!notifyTargetStudent) { txt.textContent = 'No student selected'; return; }
  if (role === 'Student') txt.textContent = 'To: ' + (notifyTargetStudent['STUDENT NAME'] || '') + ' (' + (notifyTargetStudent['EMAIL'] || 'no email on file') + ')';
  else if (role === 'Agent') txt.textContent = 'To channel partner: ' + (notifyTargetStudent['AGENT'] || 'unknown agent');
  else txt.textContent = 'To staff team';
}

async function sendNotification() {
  const role = document.getElementById('notify-role')?.value;
  const subject = document.getElementById('notify-subject')?.value || '(no subject)';
  const message = document.getElementById('notify-message')?.value || '';
  if (!message.trim()) { toast('Write a message first', 'error'); return; }
  if (!notifyTargetStudent) { toast('No student selected', 'error'); return; }

  const toEmail = role === 'Student' ? notifyTargetStudent['EMAIL'] : null;
  if (!toEmail) { toast('No email available for this recipient — message logged only.', 'info'); closeDrawer('drw-notify'); return; }

  const btn = document.getElementById('notify-send-btn');
  if (btn) btn.disabled = true;
  try {
    await sendViaEmailJS({ to_email: toEmail, to_name: notifyTargetStudent['STUDENT NAME'] || '', subject, message });
    toast('Notification sent', 'success');
    closeDrawer('drw-notify');
  } catch (e) {
    console.error('[sendNotification]', e);
    toast(e.message || 'Could not send notification', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   EMAIL PAGE (Direct Email)
═══════════════════════════════════════════════════════ */
let emailSelectedStudent = null;
let emailSearchDebounce = null;
let emailHistory = [];

function emailSearch(value) {
  clearTimeout(emailSearchDebounce);
  const box = document.getElementById('email-lookup');
  if (!box) return;
  const q = (value || '').trim();
  if (!q) { box.innerHTML = ''; box.classList.remove('open'); return; }
  emailSearchDebounce = setTimeout(() => emailSearchFirestore(q), 250);
}

async function emailSearchFirestore(q) {
  const box = document.getElementById('email-lookup');
  if (!box) return;
  box.innerHTML = '<div class="lookup-item" style="opacity:.6">Searching…</div>';
  box.classList.add('open');
  try {
    const snap = await db.collection('students').orderBy('STUDENT NAME').startAt(q).endAt(q + '\uf8ff').limit(8).get();
    if (snap.empty) { box.innerHTML = '<div class="lookup-item" style="opacity:.6">No matches</div>'; return; }
    box.innerHTML = '';
    snap.docs.forEach(d => {
      const s = d.data();
      const id = s['STUDENT ID'] || d.id;
      const item = document.createElement('div');
      item.className = 'lookup-item';
      item.innerHTML = `<div class="lookup-item-name">${escapeHtml(s['STUDENT NAME'] || '—')}</div><div class="lookup-item-sub">${escapeHtml(id)} · ${escapeHtml(s['EMAIL'] || 'no email')}</div>`;
      item.addEventListener('click', () => emailSelect({ ...s, id }));
      box.appendChild(item);
    });
  } catch (e) {
    console.error('[emailSearchFirestore]', e);
    box.innerHTML = '<div class="lookup-item" style="opacity:.6">Search failed</div>';
  }
}

function emailSelect(s) {
  emailSelectedStudent = s;
  document.getElementById('email-lookup').classList.remove('open');
  document.getElementById('email-search').value = s['STUDENT NAME'] || '';
  document.getElementById('email-sel').classList.add('show');
  setText('email-sel-name', s['STUDENT NAME'] || '—');
  setText('email-sel-sub', (s['STUDENT ID'] || s.id) + ' · ' + (s['EMAIL'] || 'no email'));
}

function emailClear() {
  emailSelectedStudent = null;
  document.getElementById('email-sel').classList.remove('show');
  document.getElementById('email-search').value = '';
}

function emailClearForm() {
  emailClear();
  ['email-subject', 'email-message'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

async function sendEmail() {
  const role = document.getElementById('email-role')?.value;
  const subject = document.getElementById('email-subject')?.value || '';
  const message = document.getElementById('email-message')?.value || '';
  if (!message.trim()) { toast('Write a message first', 'error'); return; }
  if (!emailSelectedStudent) { toast('Search and select a recipient first', 'error'); return; }

  const toEmail = emailSelectedStudent['EMAIL'];
  if (!toEmail) { toast('Selected student has no email on file', 'error'); return; }

  const lbl = document.getElementById('email-send-lbl');
  if (lbl) lbl.innerHTML = 'Sending… <span class="spinner-sm"></span>';
  try {
    await sendViaEmailJS({ to_email: toEmail, to_name: emailSelectedStudent['STUDENT NAME'] || '', subject, message });
    emailHistory.unshift({ to: emailSelectedStudent['STUDENT NAME'], email: toEmail, subject, time: nowStr() });
    renderEmailHistory();
    toast('Email sent to ' + emailSelectedStudent['STUDENT NAME'], 'success');
    emailClearForm();
  } catch (e) {
    console.error('[sendEmail]', e);
    toast(e.message || 'Could not send email', 'error');
  } finally {
    if (lbl) lbl.textContent = 'Send';
  }
}

function renderEmailHistory() {
  const wrap = document.getElementById('email-history-wrap');
  if (!wrap) return;
  if (!emailHistory.length) { wrap.innerHTML = '<div class="empty-state">No messages sent yet</div>'; return; }
  wrap.innerHTML = emailHistory.map(h => `
    <div class="email-history-item">
      <div class="email-avatar" style="background:${partnerColor(h.to)}">${partnerInitials(h.to)}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:12px">${escapeHtml(h.to)} <span style="color:var(--text-muted);font-weight:400">· ${escapeHtml(h.email)}</span></div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${escapeHtml(h.subject || '(no subject)')}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escapeHtml(h.time)}</div>
      </div>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   MOCK PRE-CAS / FEEDBACK BUILDER
═══════════════════════════════════════════════════════ */
const FB_DEFAULT_QUESTIONS = [
  'Why have you chosen this course?',
  'Why this university and this country?',
  'How will you finance your studies?',
  'What are your career plans after graduation?',
  'Why not study this course in your home country?',
  'Tell us about your academic background.'
];
let fbQA = [];
let fbPerf = 'Excellent';
let drwFeedbackTarget = null;

function initFeedbackPage() {
  document.getElementById('fb-date').value = today();
  if (!fbQA.length) fbQA = FB_DEFAULT_QUESTIONS.map(q => ({ q, good: null }));
  renderFbQARows();
  fbPreview();
}

function renderFbQARows() {
  const wrap = document.getElementById('fb-qa-rows');
  if (!wrap) return;
  wrap.innerHTML = fbQA.map((row, i) => `
    <div class="qa-row">
      <div class="qa-num">${i + 1}</div>
      <div class="qa-q">${escapeHtml(row.q)}</div>
      <div class="qa-toggles">
        <button class="qa-toggle${row.good === true ? ' sel-good' : ''}" onclick="fbSetQA(${i}, true)">Good</button>
        <button class="qa-toggle${row.good === false ? ' sel-bad' : ''}" onclick="fbSetQA(${i}, false)">Weak</button>
      </div>
    </div>`).join('') + `
    <div class="qa-summary">
      <span>Good: ${fbQA.filter(r => r.good === true).length}</span>
      <span>Weak: ${fbQA.filter(r => r.good === false).length}</span>
      <span>Unanswered: ${fbQA.filter(r => r.good === null).length}</span>
    </div>`;
}

function fbSetQA(i, val) {
  fbQA[i].good = fbQA[i].good === val ? null : val;
  renderFbQARows();
  fbPreview();
}

function pickPerf(el) {
  document.querySelectorAll('#fb-grid .perf-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
  fbPerf = el.dataset.val;
  fbPreview();
}

function toggleFbManual() {
  const wrap = document.getElementById('fb-manual');
  const btn = document.getElementById('fb-manual-btn');
  const show = wrap.style.display === 'none';
  wrap.style.display = show ? 'block' : 'none';
  btn.textContent = show ? '− Hide manual entry' : '+ Enter manually';
}

function fbCurrentStudent() {
  if (fbSelectedStudent) return { name: fbSelectedStudent['STUDENT NAME'], id: fbSelectedStudent['STUDENT ID'] || fbSelectedStudent.id };
  const name = document.getElementById('fb-mname')?.value;
  const id = document.getElementById('fb-mid')?.value;
  if (name || id) return { name, id };
  return null;
}

const PERF_BADGE_CLASS = { Excellent: 'perf-excellent', Good: 'perf-good', Satisfactory: 'perf-satisfactory', 'Needs Improvement': 'perf-needs' };

function fbPreview() {
  const preview = document.getElementById('fb-preview');
  if (!preview) return;
  const student = fbCurrentStudent();
  if (!student) {
    preview.innerHTML = `<div style="text-align:center;padding:36px 20px;color:var(--text-muted)"><div style="font-size:12px;font-weight:500">Select a student to preview</div></div>`;
    return;
  }
  const date = document.getElementById('fb-date')?.value || today();
  const stype = document.getElementById('fb-stype')?.value || '';
  const uni = document.getElementById('fb-university')?.value || '';
  const mockno = document.getElementById('fb-mockno')?.value || '1';
  const text = document.getElementById('fb-text')?.value || '';
  const recs = document.getElementById('fb-recs')?.value || '';

  preview.innerHTML = `
    <div class="doc-header">
      <div class="doc-eyebrow">Route2Uni · ${escapeHtml(stype)}</div>
      <div class="doc-title">${escapeHtml(student.name || '—')}</div>
      <div class="doc-meta-grid">
        <div class="doc-meta-item"><div class="doc-meta-label">Student ID</div><div class="doc-meta-val">${escapeHtml(student.id || '—')}</div></div>
        <div class="doc-meta-item"><div class="doc-meta-label">Date</div><div class="doc-meta-val">${escapeHtml(date)}</div></div>
        <div class="doc-meta-item"><div class="doc-meta-label">University</div><div class="doc-meta-val">${escapeHtml(uni || '—')}</div></div>
        <div class="doc-meta-item"><div class="doc-meta-label">Mock #</div><div class="doc-meta-val">${escapeHtml(mockno)}</div></div>
        <div class="doc-meta-item"><div class="doc-meta-label">Performance</div><div class="doc-meta-val"><span class="perf-badge ${PERF_BADGE_CLASS[fbPerf] || ''}">${escapeHtml(fbPerf)}</span></div></div>
      </div>
    </div>
    <div class="doc-section">
      <div class="doc-section-eyebrow">Questionnaire</div>
      <table class="doc-qa-table"><thead><tr><th>#</th><th>Question</th><th>Result</th></tr></thead>
      <tbody>${fbQA.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.q)}</td><td class="${r.good === true ? 'qa-cell-good' : r.good === false ? 'qa-cell-bad' : ''}">${r.good === true ? 'Good' : r.good === false ? 'Weak' : '—'}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="doc-section"><div class="doc-section-eyebrow">Feedback</div><div class="doc-section-text">${escapeHtml(text || '—')}</div></div>
    <div class="doc-section"><div class="doc-section-eyebrow">Recommendations</div><div class="doc-section-text">${escapeHtml(recs || '—')}</div></div>
    <div class="doc-footer"><span>Generated by ${escapeHtml((window.staff && window.staff.name) || 'Staff')}</span><span>${escapeHtml(nowStr())}</span></div>`;
}

function fbBuildDoc() {
  const student = fbCurrentStudent();
  return {
    studentName: student?.name || '',
    studentId: student?.id || '',
    date: document.getElementById('fb-date')?.value || today(),
    type: document.getElementById('fb-stype')?.value || '',
    university: document.getElementById('fb-university')?.value || '',
    mockNo: document.getElementById('fb-mockno')?.value || '1',
    qa: fbQA,
    performance: fbPerf,
    feedback: document.getElementById('fb-text')?.value || '',
    recommendations: document.getElementById('fb-recs')?.value || '',
    createdBy: (window.staff && window.staff.name) || 'Staff',
    createdAt: nowStr()
  };
}

function fbDownloadPDF() {
  const student = fbCurrentStudent();
  if (!student) { toast('Select a student first', 'error'); return; }
  if (!window.jspdf) { toast('PDF library not loaded', 'error'); return; }
  const doc = fbBuildDoc();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  pdf.setFontSize(14); pdf.text('Route2Uni — ' + doc.type, 14, 16);
  pdf.setFontSize(10);
  pdf.text(`Student: ${doc.studentName} (${doc.studentId})`, 14, 24);
  pdf.text(`Date: ${doc.date}   University: ${doc.university}   Mock #: ${doc.mockNo}`, 14, 30);
  pdf.text(`Performance: ${doc.performance}`, 14, 36);

  if (pdf.autoTable) {
    pdf.autoTable({
      startY: 42,
      head: [['#', 'Question', 'Result']],
      body: doc.qa.map((r, i) => [i + 1, r.q, r.good === true ? 'Good' : r.good === false ? 'Weak' : '—'])
    });
  }
  const afterTableY = pdf.lastAutoTable ? pdf.lastAutoTable.finalY + 10 : 50;
  pdf.text('Feedback:', 14, afterTableY);
  pdf.text(pdf.splitTextToSize(doc.feedback || '—', 180), 14, afterTableY + 6);
  pdf.text('Recommendations:', 14, afterTableY + 30);
  pdf.text(pdf.splitTextToSize(doc.recommendations || '—', 180), 14, afterTableY + 36);

  pdf.save(`${doc.studentId || 'feedback'}_${doc.date}.pdf`);
}

async function fbSave() {
  const student = fbCurrentStudent();
  if (!student) { toast('Select a student first', 'error'); return; }
  const doc = fbBuildDoc();
  showLoading('Saving feedback…');
  try {
    const ref = await db.collection('mockFeedback').add(doc);
    hideLoading();
    document.getElementById('fb-success')?.classList.add('show');
    setText('fb-success-title', 'Feedback saved for ' + doc.studentName);
    const link = document.getElementById('fb-doc-link');
    if (link) link.href = '#feedback/' + ref.id;
    toast('Feedback saved', 'success');
  } catch (e) {
    hideLoading();
    console.error('[fbSave]', e);
    toast('Could not save feedback', 'error');
  }
}

function resetFeedback() {
  document.getElementById('fb-success')?.classList.remove('show');
  fbClear();
  fbQA = FB_DEFAULT_QUESTIONS.map(q => ({ q, good: null }));
  fbPerf = 'Excellent';
  ['fb-text', 'fb-recs', 'fb-university'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('fb-date').value = today();
  renderFbQARows();
  fbPreview();
}

async function submitFeedbackDrawer() {
  if (!drwFeedbackTarget) { toast('No student selected', 'error'); return; }
  const doc = {
    studentName: drwFeedbackTarget['STUDENT NAME'] || '',
    studentId: drwFeedbackTarget['STUDENT ID'] || drwFeedbackTarget.id || '',
    date: document.getElementById('drw-fb-date')?.value || today(),
    performance: document.getElementById('drw-fb-perf')?.value || 'Good',
    feedback: document.getElementById('drw-fb-text')?.value || '',
    recommendations: document.getElementById('drw-fb-recs')?.value || '',
    createdBy: (window.staff && window.staff.name) || 'Staff',
    createdAt: nowStr()
  };
  showLoading('Saving feedback…');
  try {
    await db.collection('mockFeedback').add(doc);
    hideLoading();
    toast('Feedback saved for ' + doc.studentName, 'success');
    closeDrawer('drw-feedback');
  } catch (e) {
    hideLoading();
    console.error('[submitFeedbackDrawer]', e);
    toast('Could not save feedback', 'error');
  }
}

/* ═══════════════════════════════════════════════════════
   CAS SHIELD
═══════════════════════════════════════════════════════ */
window.casRows = window.casRows || [];

function loadCASShield() {
  const tbody = document.getElementById('cas-table-body');
  const list = window.students || [];
  if (!list.length) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No student records yet</td></tr>';
    window.casRows = [];
    return;
  }
  window.casRows = list;
  renderCASTable(window.casRows);
}

function casYN(val) {
  if (val === true) return '<span class="cas-yn-yes">✓ Yes</span>';
  if (val === false) return '<span class="cas-yn-no">— No</span>';
  const v = String(val ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'done', 'complete', 'completed'].includes(v)) return '<span class="cas-yn-yes">✓ Yes</span>';
  if (['no', 'n', 'false', '0'].includes(v)) return '<span class="cas-yn-no">— No</span>';
  return '<span class="cas-yn-warn">⚠ —</span>';
}

function renderCASTable(list) {
  const tbody = document.getElementById('cas-table-body');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No records found</td></tr>'; return; }
  tbody.innerHTML = list.map(s => {
    const id = s['STUDENT ID'] || s.id;
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${escapeHtml(id)}</td>
      <td><a onclick="openDetail('${id}')" style="cursor:pointer;font-weight:600">${escapeHtml(s['STUDENT NAME'] || '—')}</a></td>
      <td>${escapeHtml(s['AGENT'] || '—')}</td>
      <td>${escapeHtml(s['NATIONALITY'] || '—')}</td>
      <td>${escapeHtml(s['COURSE'] || '—')}</td>
      <td>${casYN(s['STUDY GAP'])}</td>
      <td>${casYN(s['SAME LEVEL'])}</td>
      <td>${casYN(s['VISA REFUSAL'])}</td>
      <td>${casYN(s['READY FOR PCI'])}</td>
      <td>${casYN(s['INFO CHECK'])}</td>
      <td>${casYN(s['PRE-CAS QUESTIONNAIRE'])}</td>
      <td>${escapeHtml(s['PCI INVITE DATE'] || '—')}</td>
      <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="openCASUpdate('${id}')">Update</button></td>
    </tr>`;
  }).join('');
}

function filterCAS() {
  const q = (document.getElementById('cas-search')?.value || '').toLowerCase();
  const pci = document.getElementById('cas-filter-pci')?.value || '';
  const visa = document.getElementById('cas-filter-visa')?.value || '';
  let list = window.casRows;
  if (q) list = list.filter(s => [s['STUDENT ID'] || s.id, s['STUDENT NAME'], s['AGENT']].join(' ').toLowerCase().includes(q));
  if (pci) list = list.filter(s => (s['READY FOR PCI'] || '').toLowerCase() === pci.toLowerCase());
  if (visa) list = list.filter(s => (s['VISA REFUSAL'] || '').toLowerCase() === visa.toLowerCase());
  renderCASTable(list);
}

let casUpdateTarget = null;
function openCASUpdate(id) {
  const s = window.casRows.find(st => (st['STUDENT ID'] || st.id) === id);
  if (!s) return;
  casUpdateTarget = s;
  setText('drw-casupd-sub', (s['STUDENT NAME'] || '—') + ' · ' + id);
  document.getElementById('cup-pci').value = /yes/i.test(s['READY FOR PCI'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-visa-r').value = /yes/i.test(s['VISA REFUSAL'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-info').value = /yes/i.test(s['INFO CHECK'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-precas').value = /yes/i.test(s['PRE-CAS QUESTIONNAIRE'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-gap').value = /yes/i.test(s['STUDY GAP'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-same').value = /yes/i.test(s['SAME LEVEL'] || '') ? 'Yes' : 'No';
  document.getElementById('cup-invite').value = s['PCI INVITE DATE'] || '';
  document.getElementById('cup-comment').value = s['CAS TEAM COMMENT'] || '';
  openDrawerEl('drw-cas-update');
}

async function submitCASUpdate() {
  if (!casUpdateTarget) return;
  const payload = {
    'READY FOR PCI': document.getElementById('cup-pci').value,
    'VISA REFUSAL': document.getElementById('cup-visa-r').value,
    'INFO CHECK': document.getElementById('cup-info').value,
    'PRE-CAS QUESTIONNAIRE': document.getElementById('cup-precas').value,
    'STUDY GAP': document.getElementById('cup-gap').value,
    'SAME LEVEL': document.getElementById('cup-same').value,
    'PCI INVITE DATE': document.getElementById('cup-invite').value,
    'CAS TEAM COMMENT': document.getElementById('cup-comment').value
  };
  const docId = casUpdateTarget.id || casUpdateTarget['STUDENT ID'];
  showLoading('Saving…');
  try {
    await db.collection('students').doc(docId).update(payload);
    hideLoading();
    toast('CAS Shield record updated', 'success');
    closeDrawer('drw-cas-update');
    loadStudentsFromFirebase();
    loadCASShield();
  } catch (e) {
    hideLoading();
    console.error('[submitCASUpdate]', e);
    toast('Could not save — check Firestore rules', 'error');
  }
}

/* ═══════════════════════════════════════════════════════
   STAGE PIPELINE — SAVE
═══════════════════════════════════════════════════════ */
async function saveStages() {
  if (!activeStudentId) return;
  const payload = {};
  Object.values(stageEdits || {}).forEach(e => { if (e && e.key) payload[e.key] = e.val; });
  if (!Object.keys(payload).length) { toast('No changes to save', 'info'); closeDrawer('drw-stage'); return; }

  const saveTxt = document.getElementById('stage-save-txt');
  const saveSpin = document.getElementById('stage-save-spin');
  if (saveTxt) saveTxt.style.display = 'none';
  if (saveSpin) saveSpin.style.display = 'inline-block';

  try {
    await db.collection('students').doc(activeStudentId).update(payload);
    toast('Pipeline updated', 'success');
    closeDrawer('drw-stage');
    loadStudentsFromFirebase();
    if (currentView === 'student-detail' && detailStudentId === activeStudentId) openDetail(activeStudentId);
  } catch (e) {
    console.error('[saveStages]', e);
    toast('Could not save stage changes', 'error');
  } finally {
    if (saveTxt) saveTxt.style.display = '';
    if (saveSpin) saveSpin.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════════════
   DAILY FOLLOW-UP
═══════════════════════════════════════════════════════ */
function renderFollowUp() {
  const wrap = document.getElementById('followup-content');
  if (!wrap) return;
  const list = window.students || [];
  const groups = {
    'Pre-screening pending': list.filter(s => !/received|withdrew/i.test(s['PRE-SCREENING CALL STATUS'] || '')),
    'Offer follow-up': list.filter(s => (s['OFFER STATUS'] || '').toLowerCase() === 'pending'),
    'CAS in progress': list.filter(s => ['Pending', 'In Progress'].includes(s['CAS STATUS']))
  };
  const sections = Object.entries(groups).filter(([, arr]) => arr.length);
  if (!sections.length) { wrap.innerHTML = '<div class="empty-state">Nothing pending today 🎉</div>'; return; }
  wrap.innerHTML = sections.map(([title, arr]) => `
    <div class="fu-group">
      <div class="fu-group-header"><span class="fu-group-title">${escapeHtml(title)}</span><span class="badge badge-amber">${arr.length}</span></div>
      <table class="dt"><tbody>${arr.map(s => `
        <tr>
          <td style="width:32px;text-align:center"><input type="checkbox" ${selectedStudentIds.has(s['STUDENT ID'] || s.id) ? 'checked' : ''} onchange="toggleSelectStudent('${s['STUDENT ID'] || s.id}', this.checked)"></td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${escapeHtml(s['STUDENT ID'] || s.id)}</td>
          <td><a onclick="openDetail('${s['STUDENT ID'] || s.id}')" style="cursor:pointer;font-weight:600">${escapeHtml(s['STUDENT NAME'] || '—')}</a></td>
          <td>${escapeHtml(s['AGENT'] || '—')}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="openDetail('${s['STUDENT ID'] || s.id}')">View</button></td>
        </tr>`).join('')}</tbody></table>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   REPORTS
═══════════════════════════════════════════════════════ */
function renderReports() {
  const list = window.students || [];
  const total = list.length;
  const approved = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === 'approved').length;
  const rate = total ? Math.round((approved / total) * 100) + '%' : '—';
  const avgStage = total ? (list.reduce((sum, s) => sum + stageDoneCount(s), 0) / total).toFixed(1) : '—';

  setText('rpt-total', total);
  setText('rpt-visa-rate', rate);
  setText('rpt-avg-stage', avgStage);

  setText('rpt-partners', (window.channelPartners || []).length);

  const byAgent = {};
  list.forEach(s => { const a = s['AGENT'] || 'Unassigned'; byAgent[a] = (byAgent[a] || 0) + 1; });
  const grid = document.getElementById('report-grid');
  if (grid) {
    const max = Math.max(...Object.values(byAgent), 1);
    const rows = Object.entries(byAgent).sort((a, b) => b[1] - a[1]).slice(0, 12);
    grid.innerHTML = `<div class="card"><div class="card-header"><div class="card-title">Students by channel partner</div></div><div class="card-body">
      ${rows.map(([name, count]) => `
        <div class="rpt-bar-row">
          <div class="rpt-bar-label">${escapeHtml(name)}</div>
          <div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:${Math.round(count / max * 100)}%"></div></div>
          <div class="rpt-bar-num">${count}</div>
        </div>`).join('') || '<div class="empty-state">No data</div>'}
    </div></div>
    <div class="card"><div class="card-header"><div class="card-title">Visa outcomes</div></div><div class="card-body">
      ${['Approved', 'Pending', 'Refused', 'Submitted'].map(v => {
        const c = list.filter(s => (s['VISA STATUS'] || '').toLowerCase() === v.toLowerCase()).length;
        return `<div class="rpt-bar-row"><div class="rpt-bar-label">${v}</div><div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:${total ? Math.round(c / total * 100) : 0}%"></div></div><div class="rpt-bar-num">${c}</div></div>`;
      }).join('')}
    </div></div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   INTERNAL CHAT
   Collection: 'chatMessages'
   Fields: { group, senderName, senderRole, text, createdAt }
═══════════════════════════════════════════════════════ */
let currentChatGroup = 'global';
let chatUnsubscribe = null;

function switchChatGroup(group, btnEl) {
  currentChatGroup = group;
  document.querySelectorAll('#chat-group-tabs .seg-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  initChatListener(group);
}

function initChatListener(group) {
  if (!db) return;
  if (typeof chatUnsubscribe === 'function') { chatUnsubscribe(); chatUnsubscribe = null; }

  const container = document.getElementById('chat-messages');
  if (container) container.innerHTML = '<div class="empty-state">Loading messages…</div>';

  try {
    chatUnsubscribe = db.collection('chatMessages')
      .where('group', '==', group)
      .orderBy('createdAt', 'asc')
      .limitToLast(200)
      .onSnapshot(snap => {
        renderChatMessages(snap.docs.map(d => d.data()));
      }, err => {
        console.error('[initChatListener] snapshot error:', err);
        if (container) container.innerHTML = '<div class="empty-state">Could not load chat. Check Firestore index/rules for chatMessages.</div>';
      });
  } catch (e) {
    console.error('[initChatListener]', e);
  }
}

function renderChatMessages(msgs) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  if (!msgs.length) { container.innerHTML = '<div class="empty-state">No messages yet — say hello 👋</div>'; return; }
  const myName = (window.staff && window.staff.name) || '';
  container.innerHTML = msgs.map(m => {
    const mine = m.senderName === myName;
    const time = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="chat-bubble${mine ? ' mine' : ''}">
      ${!mine ? `<div class="chat-meta">${escapeHtml(m.senderName || 'Unknown')}${m.senderRole ? ' · ' + escapeHtml(m.senderRole) : ''}</div>` : ''}
      <div>${escapeHtml(m.text || '')}</div>
      <span class="chat-time">${time}</span>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;
  try {
    await db.collection('chatMessages').add({
      group: currentChatGroup,
      senderName: (window.staff && window.staff.name) || 'Unknown',
      senderRole: (window.staff && window.staff.role) || '',
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (input) { input.value = ''; input.style.height = ''; }
  } catch (e) {
    console.error('[sendChatMessage]', e);
    toast('Could not send message', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
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
    toast('Tapaisanga stage update garne permission chaina', 'error');
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
        toast('Could not load university data', 'error');
      }
    } else {
      toast('Could not load universities.json — check the file exists next to index.html', 'error');
    }
  }

  setText('uni-total-count', Object.keys(UNI_DATA).length);

  if (currentView === 'universities' && typeof renderUniGrid === 'function') {
    renderUniGrid();
  }
}

document.addEventListener('DOMContentLoaded', loadUniversitiesData);

/* ═══════════════════════════════════════════════════════
   CHANNEL PARTNER — RESTRICTED VIEW
   Channel Partner role le sidebar ma "Students" ra
   "Partner Universities" matra dekhne; aafule onboard
   gareko students matra (loadStudentsFromFirebase() le
   partnerId scope garisakeko cha). Dashboard ko "all
   partners" preview pani hide garincha.
═══════════════════════════════════════════════════════ */
function applyChannelPartnerRestrictions() {
  if (window.staff?.role !== 'Channel Partner') return;

  const ALLOWED_VIEWS = ['students', 'universities'];

  // Sidebar links — allowed bahekka sabai hide
  document.querySelectorAll('.sb-link[data-view]').forEach(link => {
    const v = link.getAttribute('data-view');
    if (!ALLOWED_VIEWS.includes(v)) link.style.display = 'none';
  });

  // Naya link nabhayeko (AI Assistant, Settings, etc.) sb-link haru pani hide
  document.querySelectorAll('.sb-link:not([data-view])').forEach(link => {
    link.style.display = 'none';
  });

  // Sidebar group: kunai allowed link nabhako group lai hide (group title +
  // chevron sahit), nabhaye khali group header matra dekhinxa
  document.querySelectorAll('.sb-group').forEach(grp => {
    const allLinksInGroup = grp.querySelectorAll('.sb-link');
    const hasAllowed = Array.from(allLinksInGroup).some(l =>
      ALLOWED_VIEWS.includes(l.getAttribute('data-view'))
    );
    grp.style.display = hasAllowed ? '' : 'none';
  });

  // Dashboard ko "Channel Partners" preview section (heading + grid) hide —
  // partner le aru partner haru ko data dekhna pardaina
  document.querySelectorAll('#view-students .page-header').forEach(ph => {
    const heading = ph.querySelector('h2');
    if (heading && heading.textContent.trim() === 'Channel Partners') {
      ph.style.display = 'none';
      const grid = document.getElementById('dashboard-cp-grid');
      if (grid) grid.style.display = 'none';
    }
  });

  // Download Template / Upload Students buttons dekhaune (default hidden xan)
  const dlBtn = document.getElementById('cp-download-template-btn');
  const upBtn = document.getElementById('cp-upload-btn');
  if (dlBtn) dlBtn.style.display = '';
  if (upBtn) upBtn.style.display = '';

  // "Add student" manual button chai admin/staff ko matra rakhne — partner le
  // bulk upload prayog garos vanera hide garne (chaahe rakhna milxa, comment-out gara)
  const addBtn = document.querySelector('#view-students .page-header button[onclick="openAddStudent()"]');
  if (addBtn) addBtn.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════
   CHANNEL PARTNER — Download template / Bulk upload with
   automatic partnerId attachment
═══════════════════════════════════════════════════════ */
const CP_TEMPLATE_HEADERS = [
  'STUDENT NAME', 'DOB', 'LEVEL', 'COURSE', 'UNIVERSITY',
  'NATIONALITY', 'MOBILE', 'EMAIL', 'NOTES'
];

function downloadStudentTemplate() {
  const csv = Papa.unparse([CP_TEMPLATE_HEADERS]);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'student_upload_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function handleChannelPartnerUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (window.staff?.role !== 'Channel Partner' || !window.staff?.partnerId) {
    toast('Partner account ma Partner ID set xaina — admin lai sampark garnu', 'error');
    event.target.value = '';
    return;
  }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const rows = results.data;
      if (!rows.length) { toast('CSV ma data bhetiyena', 'error'); event.target.value = ''; return; }

      showLoading(`Uploading ${rows.length} students…`);
      let ok = 0, fail = 0;

      for (const row of rows) {
        try {
          const name = (row['STUDENT NAME'] || '').trim();
          if (!name) { fail++; continue; }

          // Auto-generate Student ID (partner prefix + timestamp-ish + random)
          const sid = 'CP-' + window.staff.partnerId.slice(0, 6) + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1000);

          const studentDoc = {
            'STUDENT ID'   : sid,
            'STUDENT NAME' : name,
            'DOB'          : (row['DOB'] || '').trim(),
            'LEVEL'        : (row['LEVEL'] || '').trim(),
            'COURSE'       : (row['COURSE'] || '').trim(),
            'UNIVERSITY'   : (row['UNIVERSITY'] || '').trim(),
            'NATIONALITY'  : (row['NATIONALITY'] || '').trim(),
            'MOBILE'       : (row['MOBILE'] || '').trim(),
            'EMAIL'        : (row['EMAIL'] || '').trim(),
            'NOTES'        : (row['NOTES'] || '').trim(),
            'AGENT'        : window.staff.name || '',
            partnerId      : window.staff.partnerId,   // ← AUTO-ATTACH, core requirement
            'ADDED DATE'   : today(),
            'ADDED BY'     : window.staff.name || 'Channel Partner',
            createdAt      : firebase.firestore.FieldValue.serverTimestamp(),
            createdBy      : window.staff.name || 'Channel Partner'
          };

          await db.collection('students').doc(sid).set(studentDoc);
          ok++;
        } catch (e) {
          console.error('[handleChannelPartnerUpload] row failed:', e);
          fail++;
        }
      }

      hideLoading();
      toast(`Uploaded ${ok} students` + (fail ? `, ${fail} failed` : ''), fail ? 'info' : 'success');
      event.target.value = '';
      loadStudentsFromFirebase(); // refresh — partnerId scoped query le auto-filter garxa
    },
    error: (err) => {
      hideLoading();
      console.error('[handleChannelPartnerUpload] parse error:', err);
      toast('CSV parse failed: ' + err.message, 'error');
      event.target.value = '';
    }
  });
}

/* ═══════════════════════════════════════════════════════
   SAFE FALLBACK FOR checkAccess / guardView
   (only used if firebase-auth.js failed to define them, so
   the app doesn't hard-crash — but access defaults to DENY)
═══════════════════════════════════════════════════════ */
if (typeof window.checkAccess !== 'function') {
  window.checkAccess = function (allowedRoles) {
    console.warn('[checkAccess] fallback in use — firebase-auth.js did not define checkAccess()');
    return !!(window.staff && allowedRoles.includes(window.staff.role));
  };
}
if (typeof window.guardView !== 'function') {
  window.guardView = function (viewName, allowedRoles) {
    if (!window.checkAccess(allowedRoles)) {
      toast('You do not have permission to view this page', 'error');
      return false;
    }
    return true;
  };
}

console.log('[script-additions.js] loaded — RBAC view-guard, login, partners, notify/email, mock pre-CAS, CAS shield, reports, internal chat (chatMessages), and Channel Partner restricted view + template upload all included');

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
    toast('Tapaisanga stage update garne permission chaina', 'error');
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
    toast('Tapaisanga onboarding garne permission chaina', 'error');
    return;
  }
  const u = UNI_DATA[key];
  if(!u) { toast('University not found', 'error'); return; }
  openAddStudent(u.title);
  toast('Onboarding for ' + u.title, 'info');
};

/* ═══════════════════════════════════════════════════════
   ADD STUDENT — Firestore-driven University/Course dropdowns
═══════════════════════════════════════════════════════ */
let UNIV_FIRESTORE_DATA = {};

async function populateUniversityDropdown() {
  const sel = document.getElementById('as-university');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading universities…</option>';
  sel.disabled = true;

  try {
    const snap = await db.collection('universities').orderBy('name').get();
    UNIV_FIRESTORE_DATA = {};

    if (snap.empty) {
      sel.innerHTML = '<option value="">No universities found — add some in Firestore</option>';
      sel.disabled = false;
      return;
    }

    snap.docs.forEach(doc => {
      const data = doc.data();
      const name = data.name || data.title || doc.id;
      const rawCourses = data.courses || [];
      const courses = rawCourses
        .map(c => (typeof c === 'string' ? c : (c && c.name)))
        .filter(Boolean);
      UNIV_FIRESTORE_DATA[doc.id] = { name, courses };
    });

    sel.innerHTML = '<option value="">Select university</option>' +
      Object.entries(UNIV_FIRESTORE_DATA)
        .map(([id, u]) => `<option value="${escapeHtml(id)}">${escapeHtml(u.name)}</option>`)
        .join('');
    sel.disabled = false;
  } catch (e) {
    console.error('[populateUniversityDropdown] failed:', e);
    sel.innerHTML = '<option value="">Could not load universities</option>';
    sel.disabled = false;
    toast('Could not load universities from Firestore', 'error');
  }
}

function onUniversitySelected(uniId) {
  const courseSel = document.getElementById('as-course');
  if (!courseSel) return;

  const uni = UNIV_FIRESTORE_DATA[uniId];
  if (!uni || !uni.courses.length) {
    courseSel.innerHTML = '<option value="">No courses listed for this university</option>';
    courseSel.disabled = true;
    return;
  }

  courseSel.disabled = false;
  courseSel.innerHTML = '<option value="">Select course</option>' +
    uni.courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

(function wrapOpenAddStudent() {
  const tryWrap = () => {
    if (typeof window.openAddStudent !== 'function' || window.__openAddStudentWrapped) return;
    const original = window.openAddStudent;
    window.openAddStudent = function (...args) {
      const result = original.apply(this, args);
      populateUniversityDropdown();
      const courseSel = document.getElementById('as-course');
      if (courseSel) {
        courseSel.innerHTML = '<option value="">Select a university first</option>';
        courseSel.disabled = true;
      }
      return result;
    };
    window.__openAddStudentWrapped = true;
  };
  tryWrap();
  document.addEventListener('DOMContentLoaded', tryWrap);
})();

/* ═══════════════════════════════════════════════════════
   MOCK PRE-CAS — real-time Firestore autocomplete
═══════════════════════════════════════════════════════ */
let fbSearchDebounce = null;
let fbSelectedStudent = null;

function fbSearch(value) {
  clearTimeout(fbSearchDebounce);
  const box = document.getElementById('fb-lookup');
  if (!box) return;

  const q = (value || '').trim();
  if (!q) { box.innerHTML = ''; box.style.display = 'none'; return; }

  fbSearchDebounce = setTimeout(() => fbSearchFirestore(q), 250);
}

async function fbSearchFirestore(q) {
  const box = document.getElementById('fb-lookup');
  if (!box) return;
  box.innerHTML = '<div class="lookup-item" style="opacity:.6">Searching…</div>';
  box.style.display = 'block';

  try {
    const snap = await db.collection('students')
      .orderBy('STUDENT NAME')
      .startAt(q)
      .endAt(q + '\uf8ff')
      .limit(8)
      .get();

    if (snap.empty) {
      box.innerHTML = '<div class="lookup-item" style="opacity:.6">No matches</div>';
      return;
    }

    box.innerHTML = '';
    snap.docs.forEach(d => {
      const s = d.data();
      const id = s['STUDENT ID'] || d.id;
      const item = document.createElement('div');
      item.className = 'lookup-item';
      item.innerHTML = `
        <div style="font-weight:600;font-size:12.5px">${escapeHtml(s['STUDENT NAME'] || '—')}</div>
        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(id)} · ${escapeHtml(s['COURSE'] || '')}</div>`;
      item.addEventListener('click', () => fbSelectFromLookup({ ...s, id }));
      box.appendChild(item);
    });
  } catch (e) {
    console.error('[fbSearchFirestore] failed:', e);
    box.innerHTML = '<div class="lookup-item" style="opacity:.6">Search failed</div>';
  }
}

function fbSelectFromLookup(s) {
  fbSelectedStudent = s;

  const box = document.getElementById('fb-lookup');
  if (box) box.style.display = 'none';

  const input = document.getElementById('fb-search');
  if (input) input.value = s['STUDENT NAME'] || '';

  const pill = document.getElementById('fb-sel');
  if (pill) pill.style.display = 'flex';
  setText('fb-sel-name', s['STUDENT NAME'] || '—');
  setText('fb-sel-sub', (s['STUDENT ID'] || s.id) + ' · ' + (s['COURSE'] || '—'));

  if (typeof fbPreview === 'function') fbPreview();
}

function fbClear() {
  fbSelectedStudent = null;
  const pill = document.getElementById('fb-sel');
  if (pill) pill.style.display = 'none';
  const input = document.getElementById('fb-search');
  if (input) input.value = '';
  if (typeof fbPreview === 'function') fbPreview();
}

document.addEventListener('click', (e) => {
  const box = document.getElementById('fb-lookup');
  const input = document.getElementById('fb-search');
  if (box && input && box.style.display !== 'none' && !box.contains(e.target) && e.target !== input) {
    box.style.display = 'none';
  }
});

document.addEventListener('click', (e) => {
  const box = document.getElementById('email-lookup');
  const input = document.getElementById('email-search');
  if (box && input && box.classList.contains('open') && !box.contains(e.target) && e.target !== input) {
    box.classList.remove('open');
  }
});

console.log('[script-additions.js] Firestore-driven university dropdown + student autocomplete loaded');
