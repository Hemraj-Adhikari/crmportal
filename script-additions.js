/**
 * CRM Application Core Utilities & Message System
 * 
 * Provides UI feedback (toasts, loading states), email integration, and
 * core navigation/view management functions.
 */

// ==============================================================================
// EMAIL CONFIGURATION & INITIALIZATION
// ==============================================================================

const EMAILJS_CONFIG = {
  publicKey: 'YOUR_EMAILJS_PUBLIC_KEY',
  serviceId: 'YOUR_EMAILJS_SERVICE_ID',
  templateId: 'YOUR_EMAILJS_TEMPLATE_ID'
};

const isEmailJsConfigured = () => !EMAILJS_CONFIG.publicKey.startsWith('YOUR_');

(function initializeEmailJS() {
  try {
    if (!window.emailjs || !isEmailJsConfigured()) return;
    emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
  } catch (error) {
    console.warn('[EmailJS] Initialization failed:', error);
  }
})();

/**
 * Sends email via EmailJS service
 * @param {Object} params - {to_email, to_name, subject, message}
 * @returns {Promise}
 */
async function sendViaEmailJS({ to_email, to_name, subject, message }) {
  if (!window.emailjs) {
    throw new Error('EmailJS SDK not available');
  }

  if (!isEmailJsConfigured()) {
    throw new Error(
      'EmailJS not configured. Update EMAILJS_CONFIG in script-additions.js with your credentials.'
    );
  }

  return emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
    to_email,
    to_name,
    subject,
    message,
    from_name: window.staff?.name || 'Route2Uni CRM'
  });
}

// ==============================================================================
// USER FEEDBACK & NOTIFICATIONS
// ==============================================================================

const TOAST_ICONS = {
  success: '✓',
  error: '✕',
  info: 'ℹ'
};

const TOAST_DURATION = 3200;
const TOAST_FADE_DURATION = 220;

/**
 * Display a toast notification
 * @param {string} message - Toast message text
 * @param {string} type - 'success', 'error', or 'info'
 */
function toast(message, type = 'success') {
  const container = document.getElementById('toast-wrap');
  if (!container) {
    console.log(`[Toast:${type}]`, message);
    return;
  }

  const toastElement = document.createElement('div');
  toastElement.className = `toast ${type}`;
  toastElement.innerHTML = `<span>${TOAST_ICONS[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toastElement);

  setTimeout(() => {
    toastElement.style.transition = 'opacity 0.2s';
    toastElement.style.opacity = '0';
    setTimeout(() => toastElement.remove(), TOAST_FADE_DURATION);
  }, TOAST_DURATION);
}

window.toast = toast;

/**
 * Show global loading overlay
 */
function showLoading(message = 'Processing...') {
  const overlay = document.getElementById('global-loading');
  const messageEl = document.getElementById('loading-msg');

  if (messageEl) messageEl.textContent = message;
  if (overlay) overlay.classList.add('show');
}

/**
 * Hide global loading overlay
 */
function hideLoading() {
  document.getElementById('global-loading')?.classList.remove('show');
}

/**
 * Get current date in YYYY-MM-DD format
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get current date and time as localized string
 */
function nowStr() {
  return new Date().toLocaleString();
}

// ==============================================================================
// SESSION INITIALIZATION HOOKS
// ==============================================================================

(function enhanceBootSession() {
  const tryWrap = () => {
    if (typeof window.bootSession !== 'function' || window.__bootSessionWrapped) return;

    const originalBootSession = window.bootSession;

    window.bootSession = function (...args) {
      const result = originalBootSession.apply(this, args);

      renderDashboardPartners();
      loadUniversitiesData();

      if (typeof startPresenceHeartbeat === 'function') {
        startPresenceHeartbeat();
      }

      if (typeof refreshChatView === 'function') {
        refreshChatView();
      }

      if (typeof applyChannelPartnerRestrictions === 'function') {
        applyChannelPartnerRestrictions();
      }

      return result;
    };

    window.__bootSessionWrapped = true;
  };

  tryWrap();
  document.addEventListener('DOMContentLoaded', tryWrap);
})();

// ==============================================================================
// VIEW MANAGEMENT & NAVIGATION
// ==============================================================================

let currentView = 'students';

// Hoisted to the top (not declared where first used) so that bootSession's
// early hooks (dashboard partners, universities, chat) can never hit a
// "Cannot access before initialization" race if Firebase Auth resolves
// a cached session before the rest of this file finishes executing.
let UNI_DATA = {};
let UNI_DATA_LOADED = false;
let currentChatGroup = 'global';
let currentChatRecipient = null; // { email, name, role } when currentChatGroup === 'direct'
window.viewHistory = [];

const VIEW_PERMISSIONS = {
  upload: ['Super Admin', 'Admin'],
  users: ['Super Admin', 'Admin'],
  reports: ['Super Admin', 'Admin', 'Document Officer'],
  partners: ['Super Admin', 'Admin', 'Document Officer'],
  casshield: ['Super Admin', 'Admin', 'Document Officer'],
  feedback: ['Super Admin', 'Admin', 'Document Officer'],
  email: ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  whatsapp: ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  followup: ['Super Admin', 'Admin', 'Document Officer', 'Application User'],
  chat: ['Super Admin', 'Admin', 'Document Officer', 'Application User']
};

const VIEW_TITLES = {
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
  chat: ['Internal Chat', 'Team-wide messaging, real-time'],
  users: ['User Management', 'Manage staff accounts, roles & access']
};

/**
 * Switch active view with permission checks and navigation tracking
 */
function switchView(viewName, linkEl, skipHistory = false) {
  const CHANNEL_PARTNER_ALLOWED_VIEWS = ['dashboard', 'students', 'universities', 'student-detail'];
  const isChannelPartner = window.staff?.role === 'Channel Partner';

  if (isChannelPartner && !CHANNEL_PARTNER_ALLOWED_VIEWS.includes(viewName)) {
    toast('You do not have access to this page', 'error');
    return;
  }

  if (VIEW_PERMISSIONS[viewName] && !guardView(viewName, VIEW_PERMISSIONS[viewName])) {
    return;
  }

  if (!skipHistory && currentView && currentView !== viewName) {
    window.viewHistory.push({
      view: currentView,
      linkEl: document.querySelector('.sb-link.active')
    });
  }

  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  const viewElement = document.getElementById(`view-${viewName}`);
  if (viewElement) viewElement.classList.add('active');

  document.querySelectorAll('.sb-link').forEach((el) => el.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');

  currentView = viewName;
  updateBackButton();

  const [title, subtitle] = VIEW_TITLES[viewName] || [viewName, ''];
  setText('page-title', title);
  setText('page-subtitle', subtitle);

  const viewInitializers = {
    dashboard: () => {
      updateStats();
      updateFunnel();
      renderDashboard();
    },
    students: () => {
      filterTableStudents();
      updateStats();
    },
    partners: () => renderPartnersGrid?.(),
    followup: () => renderFollowUp?.(),
    casshield: () => loadCASShield?.(),
    feedback: () => initFeedbackPage?.(),
    reports: () => renderReports?.(),
    chat: () => refreshChatView?.(),
    users: () => {
      if (!window.ListenerManager?.has?.('users')) {
        initUsersListener?.();
      } else {
        renderUsersTable?.();
      }
    },
    universities: () => {
      if (!window.UNI_DATA_LOADED && loadUniversitiesData) {
        loadUniversitiesData();
      } else if (typeof renderUniGrid === 'function') {
        renderUniGrid();
      }
    }
  };

  viewInitializers[viewName]?.();
}

/**
 * Navigate back in view history
 */
function goBack() {
  const previousState = window.viewHistory.pop();
  if (!previousState) {
    updateBackButton();
    return;
  }
  switchView(previousState.view, previousState.linkEl, true);
}

/**
 * Update back button visibility
 */
function updateBackButton() {
  const button = document.getElementById('hdr-back-btn');
  if (button) {
    button.style.display = window.viewHistory.length ? 'flex' : 'none';
  }
}

/**
 * Navigate to dashboard
 */
function goHome() {
  const dashboardLink = document.querySelector('.sb-link[data-view="dashboard"]');
  switchView('dashboard', dashboardLink);
}

/**
 * Return to dashboard from current view
 */
function backToDashboard() {
  const dashboardLink = document.querySelector('.sb-link[data-view="dashboard"]');
  switchView('dashboard', dashboardLink);
}

/**
 * Toggle sidebar group collapse state
 */
function toggleGroup(groupId) {
  const group = document.getElementById(groupId);
  if (group) group.classList.toggle('collapsed');
}

/**
 * Refresh current view data
 */
function refreshView() {
  if (typeof loadStudentsFromFirebase === 'function') {
    loadStudentsFromFirebase();
  }
  toast('Refreshing...', 'info');
}

/**
 * Open command palette
 */
function openCmd() {
  const overlay = document.getElementById('cmd-overlay');
  if (overlay) {
    overlay.classList.add('open');
    document.getElementById('cmd-input')?.focus();
  }
}

/**
 * Close command palette
 */
function closeCmd() {
  document.getElementById('cmd-overlay')?.classList.remove('open');
}

/**
 * Navigate via command palette
 */
function cmdNav(viewName) {
  closeCmd();
  const link = document.querySelector(`.sb-link[data-view="${viewName}"]`);
  switchView(viewName, link);
}

/**
 * Search via command palette (extensible stub)
 */
function cmdSearch() {
  // Placeholder for future search implementation
}

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    openCmd();
  }
  if (event.key === 'Escape') {
    closeCmd();
    if (typeof closeAllDrawers === 'function') {
      closeAllDrawers();
    }
  }
});

// ==============================================================================
// STUDENT TABLE MANAGEMENT
// ==============================================================================

let pillFilterField = '';
let pillFilterValue = '';
let selectedStudentIds = new Set();

/**
 * Set pill filter for student table
 */
function setPillFilterStudents(field, value, buttonElement) {
  pillFilterField = field;
  pillFilterValue = value;

  document.querySelectorAll('#view-students .seg-btn').forEach((btn) => {
    btn.classList.remove('active');
  });

  if (buttonElement) {
    buttonElement.classList.add('active');
  }

  filterTableStudents();
}

/**
 * Filter and render student table based on search and pill filters
 */
function filterTableStudents() {
  const tbody = document.getElementById('students-page-table-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('students-search-input')?.value || '').toLowerCase();
  let filteredList = window.students || [];

  if (pillFilterField === 'visa') {
    filteredList = filteredList.filter(
      (s) => (s['VISA STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase()
    );
  } else if (pillFilterField === 'offer') {
    filteredList = filteredList.filter(
      (s) => (s['OFFER STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase()
    );
  } else if (pillFilterField === 'cas') {
    filteredList = filteredList.filter(
      (s) => (s['CAS STATUS'] || '').toLowerCase() === pillFilterValue.toLowerCase()
    );
  }

  if (searchQuery) {
    filteredList = filteredList.filter((student) => {
      const searchableText = [
        student['STUDENT ID'],
        student['STUDENT NAME'],
        student['COURSE'],
        student['AGENT'],
        student['UNIVERSITY']
      ]
        .join(' ')
        .toLowerCase();
      return searchableText.includes(searchQuery);
    });
  }

  const countElement = document.getElementById('students-tbl-count');
  if (countElement) {
    countElement.textContent = `${filteredList.length} records`;
  }

  if (!filteredList.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No students found</td></tr>';
  } else {
    tbody.innerHTML = filteredList
      .map((student) => renderStudentTableRow(student))
      .join('');
  }

  updateBulkBar();
}

/**
 * Render a single student table row
 */
function renderStudentTableRow(student) {
  const id = student['STUDENT ID'] || student.id;
  const isSelected = selectedStudentIds.has(id) ? 'checked' : '';
  const visaStatus = student['VISA STATUS'] || '—';
  const visaClassMap = {
    approved: 'badge-green',
    refused: 'badge-red',
    default: 'badge-amber'
  };
  const visaClass =
    visaClassMap[visaStatus.toLowerCase()] || visaClassMap.default;

  return `<tr data-student-id="${escapeHtml(id)}">
    <td style="text-align:center">
      <input type="checkbox" ${isSelected} data-action="toggle-select" />
    </td>
    <td style="text-align:center">
      <button class="btn btn-ghost btn-sm" data-action="open-stage" title="Edit" style="padding:3px 7px">✏️</button>
    </td>
    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11.5px">${escapeHtml(id)}</td>
    <td>
      <a data-action="open-detail" style="cursor: pointer; font-weight: 600; color: var(--text-primary)">
        ${escapeHtml(student['STUDENT NAME'] || '—')}
      </a>
    </td>
    <td>${escapeHtml(student['COURSE'] || '—')}</td>
    <td>${escapeHtml(student['AGENT'] || '—')}</td>
    <td>${escapeHtml(student['OFFER STATUS'] || student['PRE-SCREENING CALL STATUS'] || '—')}</td>
    <td><span class="badge ${visaClass}">${escapeHtml(visaStatus)}</span></td>
  </tr>`;
}

/**
 * Initialize event handlers for student table
 */
function initStudentsTableEvents() {
  const tbody = document.getElementById('students-page-table-body');
  if (!tbody || tbody.dataset.eventsBound) return;

  tbody.dataset.eventsBound = 'true';

  tbody.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const row = actionElement.closest('tr[data-student-id]');
    const studentId = row?.dataset.studentId;
    if (!studentId) return;

    switch (actionElement.dataset.action) {
      case 'open-detail':
        if (typeof openDetail === 'function') openDetail(studentId);
        break;
      case 'open-stage':
        if (typeof openStageDrawer === 'function') openStageDrawer(studentId);
        break;
    }
  });

  tbody.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-action="toggle-select"]');
    if (!checkbox) return;

    const row = checkbox.closest('tr[data-student-id]');
    const studentId = row?.dataset.studentId;
    if (!studentId) return;

    toggleSelectStudent(studentId, checkbox.checked);
  });
}

document.addEventListener('DOMContentLoaded', initStudentsTableEvents);

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  const htmlMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text ?? '').replace(/[&<>"']/g, (char) => htmlMap[char]);
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

// ==============================================================================
// BULK ACTIONS
// ==============================================================================

/**
 * Send bulk email to selected students
 */
async function bulkEmail() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast('You do not have permission to send bulk emails', 'error');
    return;
  }

  const selectedList = selectedStudentsList();
  if (!selectedList.length) {
    toast('No students selected', 'error');
    return;
  }

  const withEmail = selectedList.filter((s) => s['EMAIL']);
  if (!withEmail.length) {
    toast('Selected students have no email on file', 'error');
    return;
  }

  showLoading(`Sending ${withEmail.length} emails...`);

  let successCount = 0;
  let failureCount = 0;

  for (const student of withEmail) {
    try {
      await sendViaEmailJS({
        to_email: student['EMAIL'],
        to_name: student['STUDENT NAME'] || '',
        subject: 'Update from Route2Uni',
        message: `Hi ${student['STUDENT NAME'] || ''}, this is a bulk update from your Route2Uni team.`
      });
      successCount++;
    } catch (error) {
      console.error('[bulkEmail] Failed for student:', student['STUDENT ID'], error);
      failureCount++;
    }
  }

  hideLoading();
  const message = failureCount > 0
    ? `Sent ${successCount}, failed ${failureCount}`
    : `Sent ${successCount} emails`;
  toast(message, failureCount > 0 ? 'error' : 'success');
  clearStudentSelection();
}

/**
 * Placeholder for bulk WhatsApp functionality
 */
function bulkWhatsApp() {
  const selectedList = selectedStudentsList();
  if (!selectedList.length) {
    toast('No students selected', 'error');
    return;
  }

  toast(
    `Bulk WhatsApp for ${selectedList.length} students is not yet integrated. ` +
      'Use individual WhatsApp links from student detail for now.',
    'info'
  );
}

/**
 * Placeholder for bulk status update functionality
 */
function bulkStatusUpdate() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast('You do not have permission to update statuses', 'error');
    return;
  }

  const selectedList = selectedStudentsList();
  if (!selectedList.length) {
    toast('No students selected', 'error');
    return;
  }

  toast(
    `Bulk status update for ${selectedList.length} students. ` +
      'Open each record and use "Update pipeline" for now.',
    'info'
  );
}

// ==============================================================================
// STATISTICS & KPI CALCULATIONS
// ==============================================================================

const VISA_STATUSES = {
  approved: 'Approved',
  refused: 'Refused'
};

const CAS_STATUSES = {
  pending: 'Pending',
  inProgress: 'In Progress'
};

/**
 * Update key statistics
 */
function updateStats() {
  const studentList = window.students || [];
  const total = studentList.length;
  const visaApproved = studentList.filter(
    (s) => (s['VISA STATUS'] || '').toLowerCase() === 'approved'
  ).length;
  const casActive = studentList.filter(
    (s) =>
      (s['CAS STATUS'] || '').toLowerCase() === 'pending' ||
      (s['CAS STATUS'] || '').toLowerCase() === 'in progress'
  ).length;
  const visaRefused = studentList.filter(
    (s) => (s['VISA STATUS'] || '').toLowerCase() === 'refused'
  ).length;

  setText('stat-total', total);
  setText('stat-visa', visaApproved);
  setText('stat-cas', casActive);
  setText('stat-refused', visaRefused);
}

/**
 * Set element text content safely
 */
function setText(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

/**
 * Update conversion funnel visualization
 */
function updateFunnel() {
  const studentList = window.students || [];

  const stageDefinitions = {
    applied: (s) => true,
    conditional: (s) => ['Received', 'Offer Received'].includes(s['OFFER STATUS']),
    mock: (s) => (s['MOCK PRE-CAS'] || '').toLowerCase() === 'done',
    cas: (s) => ['Pending', 'In Progress'].includes(s['CAS STATUS']),
    visa: (s) => (s['VISA STATUS'] || '').toLowerCase() === 'approved'
  };

  const stageCounts = {
    applied: studentList.length,
    conditional: studentList.filter(stageDefinitions.conditional).length,
    mock: studentList.filter(stageDefinitions.mock).length,
    cas: studentList.filter(stageDefinitions.cas).length,
    visa: studentList.filter(stageDefinitions.visa).length
  };

  setText('l-applied', stageCounts.applied);
  setText('l-cond', stageCounts.conditional);
  setText('l-mock', stageCounts.mock);
  setText('l-cas', stageCounts.cas);
  setText('l-visa', stageCounts.visa);
  setText('d-center', studentList.length);

  const labelElement = document.getElementById('pipeline-total-label');
  if (labelElement) {
    labelElement.textContent = `${studentList.length} students`;
  }

  renderFunnelChart(stageCounts);
}

/**
 * Render funnel chart visualization
 */
function renderFunnelChart(stageCounts) {
  const funnelElement = document.getElementById('pipeline-funnel');
  if (!funnelElement) return;

  const maxCount = Math.max(stageCounts.applied, 1);

  const stageRows = [
    ['Applied & called', stageCounts.applied, 'var(--navy-600)'],
    ['Conditional offer', stageCounts.conditional, 'var(--gold-500)'],
    ['Mock / Pre-CAS', stageCounts.mock, 'var(--violet-500)'],
    ['CAS in progress', stageCounts.cas, '#0EA5E9'],
    ['Visa received', stageCounts.visa, 'var(--emerald-500)']
  ];

  funnelElement.innerHTML = stageRows
    .map(([label, count, color]) => {
      const percentage = Math.round((count / maxCount) * 100);
      return `
        <div style="margin-bottom: 10px">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px">
            <span style="color: var(--text-secondary)">${label}</span>
            <span style="font-weight: 700">${count}</span>
          </div>
          <div style="background: var(--surface-inset); border-radius: 6px; height: 8px; overflow: hidden">
            <div style="background: ${color}; height: 100%; width: ${percentage}%; border-radius: 6px"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

// ==============================================================================
// DASHBOARD RENDERING
// ==============================================================================

/**
 * Render main dashboard with KPI cards and charts
 */
function renderDashboard() {
  const studentList = window.students || [];

  setText('kpi-total', studentList.length);
  setText('kpi-visa', studentList.filter((s) => (s['VISA STATUS'] || '').toLowerCase() === 'approved').length);
  setText('kpi-cas', studentList.filter((s) => ['Pending', 'In Progress'].includes(s['CAS STATUS'])).length);
  setText('kpi-refused', studentList.filter((s) => (s['VISA STATUS'] || '').toLowerCase() === 'refused').length);
  setText('kpi-offers', studentList.filter((s) => ['Received', 'Offer Received'].includes(s['OFFER STATUS'])).length);
  setText('kpi-partners', (window.channelPartners || []).length);

  renderEnrollmentTrendChart(studentList);
  renderDashboardPartners();
}

/**
 * Render enrollment trend chart (6-month view)
 */
function renderEnrollmentTrendChart(studentList) {
  const chartElement = document.getElementById('dash-enrollment-chart');
  if (!chartElement) return;

  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
    const label = monthDate.toLocaleString('en', { month: 'short' });
    months.push({ key, label, count: 0 });
  }

  studentList.forEach((student) => {
    const createdAtRaw = student['createdAt'];
    let createdAtDate = null;

    if (createdAtRaw && typeof createdAtRaw.toDate === 'function') {
      createdAtDate = createdAtRaw.toDate();
    } else if (createdAtRaw) {
      createdAtDate = new Date(createdAtRaw);
    }

    if (!createdAtDate || isNaN(createdAtDate)) return;

    const monthKey = `${createdAtDate.getFullYear()}-${createdAtDate.getMonth()}`;
    const monthBucket = months.find((m) => m.key === monthKey);

    if (monthBucket) monthBucket.count++;
  });

  const maxCount = Math.max(...months.map((m) => m.count), 1);

  chartElement.innerHTML = `
    <div style="display: flex; align-items: flex-end; gap: 10px; height: 140px; padding: 0 4px">
      ${months
        .map((monthData) => {
          const barHeight = Math.max(6, Math.round((monthData.count / maxCount) * 100));
          return `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px">
              <div style="font-size: 10.5px; font-weight: 700; color: var(--text-primary)">${monthData.count}</div>
              <div style="width: 100%; max-width: 34px; background: linear-gradient(180deg, var(--navy-600), var(--navy-800)); border-radius: 5px 5px 2px 2px; height: ${barHeight}px; transition: height 0.6s ease"></div>
              <div style="font-size: 10px; color: var(--text-muted)">${monthData.label}</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * Render dashboard partner cards (preview of first 6)
 */
function renderDashboardPartners() {
  const grid = document.getElementById('dashboard-cp-grid');
  if (!grid) return;

  if (window.staff?.role === 'Channel Partner') return;

  const partners = window.channelPartners || [];

  if (!partners.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1">No channel partners yet</div>';
    return;
  }

  grid.innerHTML = partners.slice(0, 6).map((partner) => partnerCardHTML(partner.id, partner)).join('');
}

// ==============================================================================
// CHANNEL PARTNER MANAGEMENT
// ==============================================================================

const PARTNER_COLORS = [
  '#1E3A5F', '#6B3FA0', '#1A5C38', '#7C2D12', '#0C4A6E', '#4C1D95', '#134E4A', '#713F12'
];

/**
 * Extract initials from partner name
 */
function partnerInitials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Get consistent color for partner based on name hash
 */
function partnerColor(seedString) {
  let hash = 0;
  for (let i = 0; i < (seedString || '').length; i++) {
    hash = (hash * 31 + seedString.charCodeAt(i)) >>> 0;
  }
  return PARTNER_COLORS[hash % PARTNER_COLORS.length];
}

/**
 * Generate HTML for partner card
 */
function partnerCardHTML(partnerId, partnerData) {
  const color = partnerColor(partnerData.name || partnerId);
  return `
    <div class="cp-card">
      <div class="cp-card-head">
        <div class="cp-avatar" style="background: ${color}">${partnerInitials(partnerData.name)}</div>
        <div>
          <div class="cp-name">${escapeHtml(partnerData.name || partnerId)}</div>
          <div class="cp-type">${escapeHtml(partnerData.type || 'Agent')}</div>
        </div>
      </div>
      <div class="cp-stats">
        <div>
          <div class="cp-stat-val">${partnerData.studentsCount ?? 0}</div>
          <div class="cp-stat-label">Students</div>
        </div>
        <div>
          <div class="cp-stat-val" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            ${escapeHtml(partnerData.email || '—')}
          </div>
          <div class="cp-stat-label">Email</div>
        </div>
        <div>
          <div class="cp-stat-val" style="font-size: 12px">${escapeHtml(partnerData.phone || '—')}</div>
          <div class="cp-stat-label">Phone</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render full partner grid (all partners)
 */
function renderPartnersGrid() {
  const grid = document.getElementById('full-cp-grid');
  if (!grid) return;

  const partners = window.channelPartners || [];

  if (!partners.length) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column: 1 / -1">No channel partners yet — click "Add partner" to create one.</div>';
    return;
  }

  grid.innerHTML = partners.map((partner) => partnerCardHTML(partner.id, partner)).join('');
}

/**
 * Open dialog to add new partner
 */
function openAddPartner() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast('You do not have permission to add partners', 'error');
    return;
  }

  const partnerName = prompt('Partner / agency name:');
  if (!partnerName) return;

  const partnerType =
    prompt('Type (e.g. Sub-agent, Direct, Education Consultancy):', 'Sub-agent') || 'Sub-agent';
  const partnerEmail = prompt('Contact email (optional):', '') || '';
  const partnerPhone = prompt('Contact phone (optional):', '') || '';

  showLoading('Adding partner...');

  db.collection('channelPartners')
    .add({
      name: partnerName,
      type: partnerType,
      email: partnerEmail,
      phone: partnerPhone,
      studentsCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
      hideLoading();
      toast('Partner added', 'success');
      renderPartnersGrid();
      renderDashboardPartners();
    })
    .catch((error) => {
      hideLoading();
      console.error('[openAddPartner]', error);
      toast('Could not add partner', 'error');
    });
}

/**
 * Export student records as CSV
 */
function exportStudentsCSV() {
  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast('You do not have permission to export', 'error');
    return;
  }

  const studentList = window.students || [];
  if (!studentList.length) {
    toast('No students to export', 'error');
    return;
  }

  const csv = Papa.unparse(studentList);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.download = `students_export_${today()}.csv`;
  downloadLink.click();

  URL.revokeObjectURL(url);
}

// ==============================================================================
// STUDENT DETAIL VIEW
// ==============================================================================

let detailStudentId = null;

/**
 * Open student detail view
 */
function openDetail(studentId) {
  const student = (window.students || []).find(
    (s) => (s['STUDENT ID'] || s.id) === studentId
  );

  if (!student) {
    toast('Student not found', 'error');
    return;
  }

  detailStudentId = studentId;

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-student-detail').classList.add('active');
  currentView = 'student-detail';

  renderStudentDetailPanel(student);
}

/**
 * Render student detail panel with all information
 */
function renderStudentDetailPanel(student) {
  setText('detail-name', student['STUDENT NAME'] || '—');
  setText('detail-id', student['STUDENT ID'] || student.id);
  setText('detail-level', student['LEVEL'] || '—');
  setText('detail-course', student['COURSE'] || '—');
  setText('detail-breadcrumb-name', student['STUDENT NAME'] || '—');
  setText('dp-sid', student['STUDENT ID'] || student.id);
  setText('dp-level', student['LEVEL'] || '—');
  setText('dp-sname', student['STUDENT NAME'] || '—');
  setText('dp-course', student['COURSE'] || '—');
  setText('dp-dob', student['DOB'] || '—');
  setText('dp-agent', student['AGENT'] || '—');
  setText('dp-mobile-ro', student['MOBILE'] || '—');
  setText('dp-email-ro', student['EMAIL'] || '—');

  const avatarElement = document.getElementById('detail-avatar');
  if (avatarElement) {
    avatarElement.textContent = partnerInitials(student['STUDENT NAME']);
  }

  renderStudentDocuments(student);
  renderStudentPipeline(student);
}

/**
 * Render student documents section
 */
function renderStudentDocuments(student) {
  const docsSection = document.getElementById('dp-docs-section');
  if (!docsSection) return;

  const documents = student.documents || [];

  if (!documents.length) {
    docsSection.innerHTML = 'No documents uploaded yet.';
  } else {
    docsSection.innerHTML = documents
      .map(
        (doc) =>
          `<a href="${doc.url}" target="_blank" style="display: block; margin-bottom: 6px; color: var(--navy-600)">
        ${escapeHtml(doc.name)}
      </a>`
      )
      .join('');
  }
}

/**
 * Render student pipeline/stages progress
 */
function renderStudentPipeline(student) {
  const scoreElement = document.getElementById('dp-pipeline-score');
  if (scoreElement && typeof stageDoneCount === 'function' && typeof STAGE_DEFS !== 'undefined') {
    scoreElement.textContent = `${stageDoneCount(student)} / ${STAGE_DEFS.length}`;
  }

  const pipelineList = document.getElementById('dp-pipeline-list');
  if (pipelineList && typeof stageList === 'function' && typeof stageCurrent === 'function') {
    pipelineList.innerHTML = stageList(student)
      .map(
        (stage, index) =>`
        <div class="stage-row${!stage.done && stageCurrent(student) < index ? ' locked-row' : ''}">
          <div class="stage-left">
            <span class="stage-num">${index + 1}</span>
            <span class="stage-check${stage.done ? ' done' : ''}">${stage.done ? '✓' : ''}</span>
            <span class="stage-name">${escapeHtml(stage.label)}</span>
          </div>
        </div>
      `
      )
      .join('');
  }

  const summarySection = document.getElementById('dp-stage-summary');
  if (summarySection && typeof STAGE_DEFS !== 'undefined') {
    summarySection.innerHTML = STAGE_DEFS.map(
      (stageDef) => {
        const value = student[stageDef.key] || '—';
        return `
          <div class="detail-field-row" style="grid-template-columns: 1fr">
            <span class="detail-field-label">${escapeHtml(stageDef.label)}</span>
            <span class="detail-field-val">${escapeHtml(value)}</span>
          </div>
        `;
      }
    ).join('');
  }
}

/**
 * Open notify drawer from detail view
 */
function openNotifyFromDetail() {
  if (!detailStudentId) return;

  const student = (window.students || []).find(
    (s) => (s['STUDENT ID'] || s.id) === detailStudentId
  );

  if (!student) return;

  notifyTargetStudent = student;
  setText('drw-notify-sub', `${student['STUDENT NAME'] || '—'} · ${detailStudentId}`);
  document.getElementById('notify-role').value = 'Student';
  notifyPreviewRecip();
  if (typeof openDrawerEl === 'function') {
    openDrawerEl('drw-notify');
  }
}

/**
 * Open feedback drawer from detail view
 */
function openFeedbackFromDetail() {
  if (!detailStudentId) return;

  const student = (window.students || []).find(
    (s) => (s['STUDENT ID'] || s.id) === detailStudentId
  );

  if (!student) return;

  setText('drw-fb-sub', `${student['STUDENT NAME'] || '—'} · ${detailStudentId}`);
  document.getElementById('drw-fb-date').value = today();
  drwFeedbackTarget = student;

  if (typeof openDrawerEl === 'function') {
    openDrawerEl('drw-feedback');
  }
}

// ==============================================================================
// NOTIFICATION SYSTEM
// ==============================================================================

let notifyTargetStudent = null;

/**
 * Update notification recipient preview based on selected role
 */
function notifyPreviewRecip() {
  const role = document.getElementById('notify-role')?.value;
  const recipientText = document.getElementById('notify-recip-text');

  if (!recipientText) return;

  if (!notifyTargetStudent) {
    recipientText.textContent = 'No student selected';
    return;
  }

  if (role === 'Student') {
    recipientText.textContent =
      `To: ${notifyTargetStudent['STUDENT NAME'] || '—'} (${notifyTargetStudent['EMAIL'] || 'no email on file'})`;
  } else if (role === 'Agent') {
    recipientText.textContent = `To channel partner: ${notifyTargetStudent['AGENT'] || 'unknown agent'}`;
  } else {
    recipientText.textContent = 'To staff team';
  }
}

/**
 * Send notification email to selected recipient
 */
async function sendNotification() {
  const role = document.getElementById('notify-role')?.value;
  const subject = document.getElementById('notify-subject')?.value || '(no subject)';
  const message = document.getElementById('notify-message')?.value || '';

  if (!message.trim()) {
    toast('Write a message first', 'error');
    return;
  }

  if (!notifyTargetStudent) {
    toast('No student selected', 'error');
    return;
  }

  const toEmail = role === 'Student' ? notifyTargetStudent['EMAIL'] : null;

  if (!toEmail) {
    toast('No email available for this recipient — message logged only.', 'info');
    if (typeof closeDrawer === 'function') {
      closeDrawer('drw-notify');
    }
    return;
  }

  const sendButton = document.getElementById('notify-send-btn');
  if (sendButton) sendButton.disabled = true;

  try {
    await sendViaEmailJS({
      to_email: toEmail,
      to_name: notifyTargetStudent['STUDENT NAME'] || '',
      subject,
      message
    });

    if (typeof logActivity === 'function') {
      logActivity(
        'Send',
        'Notification',
        notifyTargetStudent['STUDENT ID'] || notifyTargetStudent.id || null
      );
    }

    toast('Notification sent', 'success');
    if (typeof closeDrawer === 'function') {
      closeDrawer('drw-notify');
    }
  } catch (error) {
    console.error('[sendNotification]', error);
    toast(error.message || 'Could not send notification', 'error');
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}

// ==============================================================================
// DIRECT EMAIL MODULE
// ==============================================================================

let emailSelectedStudent = null;
let emailSearchDebounce = null;
let emailHistory = [];

const EMAIL_SEARCH_DEBOUNCE_DELAY = 250;
const EMAIL_SEARCH_RESULT_LIMIT = 8;

/**
 * Search for students by name (debounced)
 */
function emailSearch(searchValue) {
  clearTimeout(emailSearchDebounce);

  const lookupBox = document.getElementById('email-lookup');
  if (!lookupBox) return;

  const query = (searchValue || '').trim();

  if (!query) {
    lookupBox.innerHTML = '';
    lookupBox.classList.remove('open');
    return;
  }

  emailSearchDebounce = setTimeout(() => emailSearchFirestore(query), EMAIL_SEARCH_DEBOUNCE_DELAY);
}

/**
 * Execute Firestore search for students
 */
async function emailSearchFirestore(query) {
  const lookupBox = document.getElementById('email-lookup');
  if (!lookupBox) return;

  lookupBox.innerHTML = '<div class="lookup-item" style="opacity: 0.6">Searching...</div>';
  lookupBox.classList.add('open');

  try {
    const snapshot = await db
      .collection('students')
      .orderBy('STUDENT NAME')
      .startAt(query)
      .endAt(query + '\uf8ff')
      .limit(EMAIL_SEARCH_RESULT_LIMIT)
      .get();

    if (snapshot.empty) {
      lookupBox.innerHTML = '<div class="lookup-item" style="opacity: 0.6">No matches</div>';
      return;
    }

    lookupBox.innerHTML = '';

    snapshot.docs.forEach((doc) => {
      const student = doc.data();
      const studentId = student['STUDENT ID'] || doc.id;

      const resultItem = document.createElement('div');
      resultItem.className = 'lookup-item';
      resultItem.innerHTML = `
        <div class="lookup-item-name">${escapeHtml(student['STUDENT NAME'] || '—')}</div>
        <div class="lookup-item-sub">
          ${escapeHtml(studentId)} · ${escapeHtml(student['EMAIL'] || 'no email')}
        </div>
      `;

      resultItem.addEventListener('click', () =>
        emailSelect({ ...student, id: studentId })
      );

      lookupBox.appendChild(resultItem);
    });
  } catch (error) {
    console.error('[emailSearchFirestore]', error);
    lookupBox.innerHTML = '<div class="lookup-item" style="opacity: 0.6">Search failed</div>';
  }
}

/**
 * Select student as email recipient
 */
function emailSelect(student) {
  emailSelectedStudent = student;

  document.getElementById('email-lookup').classList.remove('open');
  document.getElementById('email-search').value = student['STUDENT NAME'] || '';
  document.getElementById('email-sel').classList.add('show');

  setText('email-sel-name', student['STUDENT NAME'] || '—');
  setText(
    'email-sel-sub',
    `${student['STUDENT ID'] || student.id} · ${student['EMAIL'] || 'no email'}`
  );
}

/**
 * Clear selected recipient
 */
function emailClear() {
  emailSelectedStudent = null;
  document.getElementById('email-sel').classList.remove('show');
  document.getElementById('email-search').value = '';
}

/**
 * Clear entire email form
 */
function emailClearForm() {
  emailClear();

  ['email-subject', 'email-message'].forEach((elementId) => {
    const element = document.getElementById(elementId);
    if (element) element.value = '';
  });
}

/**
 * Send direct email to selected recipient
 */
async function sendEmail() {
  const subject = document.getElementById('email-subject')?.value || '';
  const message = document.getElementById('email-message')?.value || '';

  if (!message.trim()) {
    toast('Write a message first', 'error');
    return;
  }

  if (!emailSelectedStudent) {
    toast('Search and select a recipient first', 'error');
    return;
  }

  const toEmail = emailSelectedStudent['EMAIL'];
  if (!toEmail) {
    toast('Selected student has no email on file', 'error');
    return;
  }

  const sendLabel = document.getElementById('email-send-lbl');
  if (sendLabel) sendLabel.innerHTML = 'Sending... <span class="spinner-sm"></span>';

  try {
    await sendViaEmailJS({
      to_email: toEmail,
      to_name: emailSelectedStudent['STUDENT NAME'] || '',
      subject,
      message
    });

    emailHistory.unshift({
      to: emailSelectedStudent['STUDENT NAME'],
      email: toEmail,
      subject,
      time: nowStr()
    });

    renderEmailHistory();
    toast(`Email sent to ${emailSelectedStudent['STUDENT NAME']}`, 'success');
    emailClearForm();
  } catch (error) {
    console.error('[sendEmail]', error);
    toast(error.message || 'Could not send email', 'error');
  } finally {
    if (sendLabel) sendLabel.textContent = 'Send';
  }
}

/**
 * Render email history
 */
function renderEmailHistory() {
  const historyContainer = document.getElementById('email-history-wrap');
  if (!historyContainer) return;

  if (!emailHistory.length) {
    historyContainer.innerHTML = '<div class="empty-state">No messages sent yet</div>';
    return;
  }

  historyContainer.innerHTML = emailHistory
    .map(
      (historyEntry) => `
    <div class="email-history-item">
      <div class="email-avatar" style="background: ${partnerColor(historyEntry.to)}">
        ${partnerInitials(historyEntry.to)}
      </div>
      <div style="flex: 1">
        <div style="font-weight: 600; font-size: 12px">
          ${escapeHtml(historyEntry.to)}
          <span style="color: var(--text-muted); font-weight: 400">· ${escapeHtml(historyEntry.email)}</span>
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px">
          ${escapeHtml(historyEntry.subject || '(no subject)')}
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px">
          ${escapeHtml(historyEntry.time)}
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

// ==============================================================================
// MOCK PRE-CAS FEEDBACK MODULE
// ==============================================================================

const FB_DEFAULT_QUESTIONS = [
  'Why have you chosen this course?',
  'Why this university and this country?',
  'How will you finance your studies?',
  'What are your career plans after graduation?',
  'Why not study this course in your home country?',
  'Tell us about your academic background.'
];

const PERFORMANCE_BADGE_CLASSES = {
  'Excellent': 'perf-excellent',
  'Good': 'perf-good',
  'Satisfactory': 'perf-satisfactory',
  'Needs Improvement': 'perf-needs'
};

let fbQA = [];
let fbPerf = 'Excellent';
let drwFeedbackTarget = null;

/**
 * Initialize feedback page on view switch
 */
function initFeedbackPage() {
  document.getElementById('fb-date').value = today();

  if (!fbQA.length) {
    fbQA = FB_DEFAULT_QUESTIONS.map((question) => ({ q: question, good: null }));
  }

  renderFbQARows();
  fbPreview();
}

/**
 * Render feedback questionnaire rows with scoring buttons
 */
function renderFbQARows() {
  const container = document.getElementById('fb-qa-rows');
  if (!container) return;

  const goodCount = fbQA.filter((row) => row.good === true).length;
  const weakCount = fbQA.filter((row) => row.good === false).length;
  const unansweredCount = fbQA.filter((row) => row.good === null).length;

  const rowsHTML = fbQA
    .map(
      (row, index) =>`
    <div class="qa-row">
      <div class="qa-num">${index + 1}</div>
      <div class="qa-q">${escapeHtml(row.q)}</div>
      <div class="qa-toggles">
        <button class="qa-toggle${row.good === true ? ' sel-good' : ''}" onclick="fbSetQA(${index}, true)">
          Good
        </button>
        <button class="qa-toggle${row.good === false ? ' sel-bad' : ''}" onclick="fbSetQA(${index}, false)">
          Weak
        </button>
      </div>
    </div>
  `
    )
    .join('');

  const summaryHTML = `
    <div class="qa-summary">
      <span>Good: ${goodCount}</span>
      <span>Weak: ${weakCount}</span>
      <span>Unanswered: ${unansweredCount}</span>
    </div>
  `;

  container.innerHTML = rowsHTML + summaryHTML;
}

/**
 * Toggle question answer status
 */
function fbSetQA(questionIndex, isGood) {
  fbQA[questionIndex].good =
    fbQA[questionIndex].good === isGood ? null : isGood;
  renderFbQARows();
  fbPreview();
}

/**
 * Select performance level
 */
function pickPerf(performanceElement) {
  document.querySelectorAll('#fb-grid .perf-opt').forEach((option) => {
    option.classList.remove('sel');
  });

  performanceElement.classList.add('sel');
  fbPerf = performanceElement.dataset.val;
  fbPreview();
}

/**
 * Toggle manual student entry section
 */
function toggleFbManual() {
  const manualSection = document.getElementById('fb-manual');
  const toggleButton = document.getElementById('fb-manual-btn');

  if (!manualSection || !toggleButton) return;

  const isHidden = manualSection.style.display === 'none';

  manualSection.style.display = isHidden ? 'block' : 'none';
  toggleButton.textContent = isHidden ? '− Hide manual entry' : '+ Enter manually';
}

/**
 * Get current student (from drawer target or manual input)
 */
function fbCurrentStudent() {
  if (typeof fbSelectedStudent !== 'undefined' && fbSelectedStudent) {
    return {
      name: fbSelectedStudent['STUDENT NAME'],
      id: fbSelectedStudent['STUDENT ID'] || fbSelectedStudent.id
    };
  }

  const manualName = document.getElementById('fb-mname')?.value;
  const manualId = document.getElementById('fb-mid')?.value;

  if (manualName || manualId) {
    return { name: manualName, id: manualId };
  }

  return null;
}

/**
 * Generate HTML preview of feedback document
 */
function fbPreview() {
  const previewElement = document.getElementById('fb-preview');
  if (!previewElement) return;

  const student = fbCurrentStudent();

  if (!student) {
    previewElement.innerHTML = `
      <div style="text-align: center; padding: 36px 20px; color: var(--text-muted)">
        <div style="font-size: 12px; font-weight: 500">Select a student to preview</div>
      </div>
    `;
    return;
  }

  const date = document.getElementById('fb-date')?.value || today();
  const sessionType = document.getElementById('fb-stype')?.value || '';
  const university = document.getElementById('fb-university')?.value || '';
  const mockNumber = document.getElementById('fb-mockno')?.value || '1';
  const feedbackText = document.getElementById('fb-text')?.value || '';
  const recommendationsText = document.getElementById('fb-recs')?.value || '';

  const answerRows = fbQA
    .map(
      (row, index) =>`
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.q)}</td>
        <td class="${row.good === true ? 'qa-cell-good' : row.good === false ? 'qa-cell-bad' : ''}">
          ${row.good === true ? 'Good' : row.good === false ? 'Weak' : '—'}
        </td>
      </tr>
    `
    )
    .join('');

  const badgeClass = PERFORMANCE_BADGE_CLASSES[fbPerf] || '';

  previewElement.innerHTML = `
    <div class="doc-header">
      <div class="doc-eyebrow">Route2Uni · ${escapeHtml(sessionType)}</div>
      <div class="doc-title">${escapeHtml(student.name || '—')}</div>
      <div class="doc-meta-grid">
        <div class="doc-meta-item">
          <div class="doc-meta-label">Student ID</div>
          <div class="doc-meta-val">${escapeHtml(student.id || '—')}</div>
        </div>
        <div class="doc-meta-item">
          <div class="doc-meta-label">Date</div>
          <div class="doc-meta-val">${escapeHtml(date)}</div>
        </div>
        <div class="doc-meta-item">
          <div class="doc-meta-label">University</div>
          <div class="doc-meta-val">${escapeHtml(university || '—')}</div>
        </div>
        <div class="doc-meta-item">
          <div class="doc-meta-label">Mock #</div>
          <div class="doc-meta-val">${escapeHtml(mockNumber)}</div>
        </div>
        <div class="doc-meta-item">
          <div class="doc-meta-label">Performance</div>
          <div class="doc-meta-val">
            <span class="perf-badge ${badgeClass}">${escapeHtml(fbPerf)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="doc-section">
      <div class="doc-section-eyebrow">Questionnaire</div>
      <table class="doc-qa-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${answerRows}
        </tbody>
      </table>
    </div>

    <div class="doc-section">
      <div class="doc-section-eyebrow">Feedback</div>
      <div class="doc-section-text">${escapeHtml(feedbackText || '—')}</div>
    </div>

    <div class="doc-section">
      <div class="doc-section-eyebrow">Recommendations</div>
      <div class="doc-section-text">${escapeHtml(recommendationsText || '—')}</div>
    </div>

    <div class="doc-footer">
      <span>Generated by ${escapeHtml((window.staff && window.staff.name) || 'Staff')}</span>
      <span>${escapeHtml(nowStr())}</span>
    </div>
  `;
}

/**
 * Build feedback document object for storage
 */
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

/**
 * Download feedback document as PDF
 */
function fbDownloadPDF() {
  const student = fbCurrentStudent();
  if (!student) {
    toast('Select a student first', 'error');
    return;
  }

  if (!window.jspdf) {
    toast('PDF library not loaded', 'error');
    return;
  }

  const doc = fbBuildDoc();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  pdf.setFontSize(14);
  pdf.text(`Route2Uni — ${doc.type}`, 14, 16);

  pdf.setFontSize(10);
  pdf.text(`Student: ${doc.studentName} (${doc.studentId})`, 14, 24);
  pdf.text(
    `Date: ${doc.date}   University: ${doc.university}   Mock #: ${doc.mockNo}`,
    14,
    30
  );
  pdf.text(`Performance: ${doc.performance}`, 14, 36);

  if (pdf.autoTable) {
    pdf.autoTable({
      startY: 42,
      head: [['#', 'Question', 'Result']],
      body: doc.qa.map((row, index) => [
        index + 1,
        row.q,
        row.good === true ? 'Good' : row.good === false ? 'Weak' : '—'
      ])
    });
  }

  const afterTableY = pdf.lastAutoTable ? pdf.lastAutoTable.finalY + 10 : 50;

  pdf.text('Feedback:', 14, afterTableY);
  pdf.text(pdf.splitTextToSize(doc.feedback || '—', 180), 14, afterTableY + 6);

  pdf.text('Recommendations:', 14, afterTableY + 30);
  pdf.text(
    pdf.splitTextToSize(doc.recommendations || '—', 180),
    14,
    afterTableY + 36
  );

  pdf.save(`${doc.studentId || 'feedback'}_${doc.date}.pdf`);
}

/**
 * Save feedback to Firestore and show success
 */
async function fbSave() {
  const student = fbCurrentStudent();
  if (!student) {
    toast('Select a student first', 'error');
    return;
  }

  const doc = fbBuildDoc();
  showLoading('Saving feedback...');

  try {
    await db.collection('mockFeedback').add(doc);
    hideLoading();

    const successElement = document.getElementById('fb-success');
    if (successElement) {
      successElement.classList.add('show');
    }

    toast('Feedback saved successfully', 'success');
  } catch (error) {
    hideLoading();
    console.error('[fbSave]', error);
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
    if (typeof logActivity === 'function') logActivity('Update', 'Follow-up', docId);
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
    if (typeof logActivity === 'function') logActivity('Update', 'Follow-up', activeStudentId);
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


function switchChatGroup(group, btnEl) {
  currentChatGroup = group;

  document.querySelectorAll('#chat-group-tabs .seg-btn')
    .forEach(btn => btn.classList.remove('active'));

  if (btnEl) btnEl.classList.add('active');

  const contactsPanel = document.getElementById('chat-contacts-panel');
  const threadHeader = document.getElementById('chat-thread-header');

  if (group === 'direct') {
    if (contactsPanel) contactsPanel.style.display = '';
    populateChatRecipients();
    updateChatThreadHeader();
  } else {
    if (contactsPanel) contactsPanel.style.display = 'none';
    if (threadHeader) { threadHeader.style.display = 'none'; threadHeader.innerHTML = ''; }
    currentChatRecipient = null;
  }

  refreshChatView();
}

/**
 * Deterministic Firestore "group" id for a 1:1 direct-message thread
 * between the current user and another user (order-independent).
 */
function directGroupId(otherEmail) {
  const me = (firebase.auth().currentUser?.email || '').toLowerCase();
  const other = (otherEmail || '').toLowerCase();
  return 'dm_' + [me, other].sort().join('__');
}

// ==============================================================================
// CHAT PRESENCE ("who's online") + PEOPLE LIST FOR DIRECT MESSAGES
// ==============================================================================

// A user counts as "online" if their presence doc was refreshed within this
// window. The heartbeat below writes every 25s, so 45s comfortably covers
// one missed beat without flashing offline/online.
const PRESENCE_ONLINE_MS = 45000;
const PRESENCE_HEARTBEAT_MS = 25000;

let __presenceInterval = null;
let __chatContactsRefreshInterval = null;

function isUserOnline(u) {
  const ts = u && u.lastSeen && typeof u.lastSeen.toDate === 'function'
    ? u.lastSeen.toDate().getTime()
    : null;
  return !!ts && (Date.now() - ts) < PRESENCE_ONLINE_MS;
}

/**
 * Marks the signed-in user online/offline. Only touches the `online` and
 * `lastSeen` fields — Firestore rules only allow a user to write their own
 * doc for exactly those two fields, so this never needs Admin rights.
 */
async function writePresence(online) {
  try {
    const email = (firebase.auth().currentUser?.email || '').toLowerCase();
    if (!email || !window.db) return;
    await db.collection('users').doc(email).update({
      online: online,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('[presence] could not update status:', e);
  }
}

/**
 * Starts the presence heartbeat for the signed-in session: marks online
 * immediately, then refreshes every 25s while the tab is visible, and
 * marks offline on tab close / navigation away.
 */
function startPresenceHeartbeat() {
  if (__presenceInterval) return; // already running for this session

  writePresence(true);

  __presenceInterval = setInterval(() => {
    if (document.visibilityState !== 'hidden') writePresence(true);
  }, PRESENCE_HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') writePresence(true);
  });

  window.addEventListener('beforeunload', () => writePresence(false));

  ensureChatContactsRefreshLoop();
}

/**
 * Since a person can go stale (tab closed without a clean beforeunload)
 * without triggering a new Firestore snapshot, re-render the dots on a
 * timer too so "Online" flips to "Offline" once their heartbeat lapses.
 */
function ensureChatContactsRefreshLoop() {
  if (__chatContactsRefreshInterval) return;
  __chatContactsRefreshInterval = setInterval(() => {
    if (currentView === 'chat' && currentChatGroup === 'direct') {
      renderChatContacts();
      updateChatThreadHeader();
    }
  }, 15000);
}

function ccInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

/**
 * Loads the people list (Admin/Staff + Channel Partners) from the 'users'
 * collection (window.__allUsers) and renders it.
 */
function populateChatRecipients() {
  if (typeof initUsersListener === 'function' && !window.ListenerManager.has('users')) {
    initUsersListener();
  }
  renderChatContacts();
}

/**
 * Renders the clickable "People" list for Direct Message, with a live
 * green/grey dot showing who's currently online. Selecting a person opens
 * (or creates) the 1:1 thread with them — see selectChatContact() and the
 * delegated click listener registered near the bottom of this file.
 */
function renderChatContacts() {
  const list = document.getElementById('chat-contacts-list');
  if (!list) return;

  const myEmail = (firebase.auth().currentUser?.email || '').toLowerCase();
  const users = (window.__allUsers || [])
    .filter(u => (u.email || '').toLowerCase() !== myEmail && u.active !== false)
    .sort((a, b) => {
      const aOn = isUserOnline(a) ? 0 : 1;
      const bOn = isUserOnline(b) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn; // online people float to the top
      return (a.name || a.email || '').localeCompare(b.name || b.email || '');
    });

  if (!users.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px 8px;font-size:12px">No other users found</div>';
    return;
  }

  list.innerHTML = users.map(u => {
    const email = (u.email || '').toLowerCase();
    const name = u.name || u.email || 'Unknown';
    const role = u.role || '';
    const online = isUserOnline(u);
    const active = !!(currentChatRecipient && currentChatRecipient.email === email);
    const avatarColor = typeof umAvatarColor === 'function' ? umAvatarColor(name) : '#3B82F6';

    return `
      <div class="cc-item${active ? ' active' : ''}" data-email="${escapeHtml(email)}" data-name="${escapeHtml(name)}" data-role="${escapeHtml(role)}">
        <div class="cc-avatar" style="background:${avatarColor}">
          ${escapeHtml(ccInitials(name))}
          <span class="cc-dot${online ? ' online' : ''}"></span>
        </div>
        <div style="min-width:0">
          <div class="cc-name">${escapeHtml(name)}</div>
          <div class="cc-sub">${role ? escapeHtml(role) + ' · ' : ''}${online ? 'Online' : 'Offline'}</div>
        </div>
      </div>`;
  }).join('');
}

/**
 * Called when a person is clicked in the People list — opens (or switches
 * to) that 1:1 direct-message thread.
 */
function selectChatContact(email, name, role) {
  if (!email) return;
  currentChatRecipient = { email, name: name || email, role: role || '' };
  renderChatContacts();      // refresh highlight on the selected row
  updateChatThreadHeader();
  refreshChatView();
}

// Delegated click handler — the list is re-rendered often, so we bind once
// on a stable ancestor instead of re-binding per item.
document.addEventListener('click', (e) => {
  const item = e.target.closest('#chat-contacts-list .cc-item');
  if (!item) return;
  selectChatContact(item.dataset.email, item.dataset.name, item.dataset.role);
});

/**
 * Shows "You're chatting with <name> [role] · Online/Offline" above the
 * message list whenever a Direct Message thread is open, so it's always
 * clear who a message is going to / coming from.
 */
function updateChatThreadHeader() {
  const header = document.getElementById('chat-thread-header');
  if (!header) return;

  if (currentChatGroup !== 'direct' || !currentChatRecipient) {
    header.style.display = 'none';
    header.innerHTML = '';
    return;
  }

  const u = (window.__allUsers || []).find(x => (x.email || '').toLowerCase() === currentChatRecipient.email);
  const online = u ? isUserOnline(u) : false;

  header.style.display = 'flex';
  header.innerHTML = `
    <span class="cth-dot${online ? ' online' : ''}"></span>
    <span>${escapeHtml(currentChatRecipient.name)}</span>
    <span style="font-weight:400;color:var(--text-muted)">${currentChatRecipient.role ? '· ' + escapeHtml(currentChatRecipient.role) + ' ' : ''}· ${online ? 'Online' : 'Offline'}</span>
  `;
}

/**
 * Re-attaches the chat listener for whatever is currently selected
 * (Global / Staff Only / a specific Direct Message thread).
 */
function refreshChatView() {
  updateChatThreadHeader();

  if (currentChatGroup === 'direct') {
    if (currentChatRecipient) {
      initChatListener(directGroupId(currentChatRecipient.email));
    } else {
      const container = document.getElementById('chat-messages');
      if (container) {
        container.innerHTML = '<div class="empty-state">Select a person from the list to start a conversation.</div>';
      }
    }
    return;
  }

  initChatListener(currentChatGroup || 'global');
}

function initChatListener(group) {
  if (!db) return;

  const container = document.getElementById('chat-messages');

  if (container) {
    container.innerHTML =
      '<div class="empty-state">Loading messages...</div>';
  }

  window.ListenerManager.register(
    'chat',
    () => db.collection('chatMessages')
      .where('group', '==', group)
      .orderBy('createdAt', 'asc')
      .limitToLast(200)
      .onSnapshot(snapshot => {
        renderChatMessages(snapshot.docs.map(doc => doc.data()));
      }, error => {
        console.error(error);

        if (container) {
          container.innerHTML =
            '<div class="empty-state">Could not load chat.</div>';
        }
      })
  );
}

function renderChatMessages(messages) {

  const container = document.getElementById('chat-messages');

  if (!container) return;

  if (!messages.length) {
    container.innerHTML =
      '<div class="empty-state">No messages yet 👋</div>';
    return;
  }

  const myEmail = (firebase.auth().currentUser?.email || '').toLowerCase();

  container.innerHTML = messages.map(msg => {

    const mine = (msg.senderEmail || '').toLowerCase() === myEmail;

    const time =
      msg.createdAt && msg.createdAt.toDate
        ? msg.createdAt.toDate().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })
        : '';

    return `
      <div class="chat-bubble ${mine ? 'mine' : ''}">
        ${
          !mine
            ? `<div class="chat-meta">
                ${escapeHtml(msg.senderName || 'Unknown')}
                ${msg.senderRole ? ' · ' + escapeHtml(msg.senderRole) : ''}
               </div>`
            : ''
        }

        <div>${escapeHtml(msg.text || '')}</div>

        <span class="chat-time">${time}</span>
      </div>
    `;

  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {

  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');

  if (!input) return;

  const text = input.value.trim();

  if (!text) return;

  if (currentChatGroup === 'direct' && !currentChatRecipient) {
    toast('Select a recipient first', 'error');
    return;
  }

  const groupId =
    currentChatGroup === 'direct'
      ? directGroupId(currentChatRecipient.email)
      : currentChatGroup;

  try {

    if (btn) btn.disabled = true;

    await db.collection('chatMessages').add({

      group: groupId,

      isDirect: currentChatGroup === 'direct',

      toEmail: currentChatGroup === 'direct' ? currentChatRecipient.email : null,
      toName: currentChatGroup === 'direct' ? currentChatRecipient.name : null,

      senderName:
        (window.staff && window.staff.name) || 'Unknown',

      senderEmail:
        firebase.auth().currentUser.email.toLowerCase(),

      senderRole:
        (window.staff && window.staff.role) || '',

      text: text,

      createdAt:
        firebase.firestore.FieldValue.serverTimestamp()

    });

    if (typeof logActivity === 'function') {
      logActivity(
        'Send',
        'Chat Message',
        null,
        {
          group: groupId,
          direct: currentChatGroup === 'direct',
          to: currentChatRecipient?.email || null
        }
      );
    }

    input.value = '';
    input.style.height = '';

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

  document.querySelectorAll('#view-students .page-header').forEach(ph => {
    const heading = ph.querySelector('h2');
    if (heading && heading.textContent.trim() === 'Channel Partners') {
      ph.style.display = 'none';
      const grid = document.getElementById('dashboard-cp-grid');
      if (grid) grid.style.display = 'none';
    }
  });

  const dlBtn = document.getElementById('cp-download-template-btn');
  const upBtn = document.getElementById('cp-upload-btn');
  if (dlBtn) dlBtn.style.display = '';
  if (upBtn) upBtn.style.display = '';

  // "Add student" manual button chai admin/staff ko matra rakhne — partner le
  // bulk upload prayog garos vanera hide garne (chaahe rakhna milxa, comment-out gara)
  const addBtn = document.querySelector('#view-students .page-header button[onclick="openAddStudent()"]');
  if (addBtn) addBtn.style.display = 'none';
}

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
          contentHTML += `<div class="stage-opt${isSel ? ' selected' : ''}${!mockUnlocked ? ' locked-row' : ''}" onclick="pickMockStage(this,${i},'${escapeHtml(ms)}',${mi},${curLevel})" style="${!mockUnlocked ? 'opacity:.4;pointer-events:none' : ''}"><span class="stage-opt-icon">${isSel || curLevel >= mi ? '' : ''}</span>Mock ${ms}</div>`;
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

window.__allUsers = window.__allUsers || [];
window.__usersListenerStarted = false;
let umCurrentPage = 1;
let umOpenMenuId = null;

const UM_ROLE_COLORS = {
  'Super Admin'         : { bg: '#FCE7F3', fg: '#DB2777' },
  'Admin'               : { bg: '#FEF3C7', fg: '#B45309' },
  'Documentation Officer': { bg: '#D1FAE5', fg: '#059669' },
  'Application User'    : { bg: '#DBEAFE', fg: '#2563EB' },
  'Channel Partner'     : { bg: '#FEE2E2', fg: '#DC2626' },
  'Branch Manager'      : { bg: '#FFEDD5', fg: '#EA580C' }
};

const UM_AVATAR_COLORS = ['#EC4899','#3B82F6','#10B981','#F59E0B','#8B5CF6','#06B6D4','#EF4444','#6366F1'];

function umAvatarColor(name) {
  const str = String(name || '?');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return UM_AVATAR_COLORS[Math.abs(hash) % UM_AVATAR_COLORS.length];
}

function umInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function umFmtDate(val) {
  if (!val) return '—';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '—';
    return (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
           d.getDate().toString().padStart(2, '0') + '/' + d.getFullYear();
  } catch { return '—'; }
}

function initUsersListener() {
  if (!window.db) { toast('Firestore not ready', 'error'); return; }
  if (window.ListenerManager.has('users')) return; // already streaming — avoid duplicate listener
  document.getElementById('um-table-body').innerHTML = '<tr><td colspan="7" class="empty-state">Loading…</td></tr>';

  window.ListenerManager.register('users', () => db.collection('users').onSnapshot(
    (snap) => {
      window.__allUsers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      umUpdateKpiCards();
      umCurrentPage = 1;
      renderUsersTable();

      // Live-refresh the chat "People" list / thread header the instant
      // anyone's presence (online/lastSeen) or profile changes.
      if (currentChatGroup === 'direct') {
        if (typeof renderChatContacts === 'function') renderChatContacts();
        if (typeof updateChatThreadHeader === 'function') updateChatThreadHeader();
      }
    },
    (err) => {
      console.error('users listener error:', err);
      document.getElementById('um-table-body').innerHTML =
        '<tr><td colspan="7" class="empty-state">Failed to load users — check Firestore rules/connection.</td></tr>';
      toast('Could not load users', 'error');
    }
  ));
}

function umUpdateKpiCards() {
  const users = window.__allUsers || [];
  const counts = { 'Super Admin': 0, 'Admin': 0, 'Documentation Officer': 0, 'Application User': 0, 'Channel Partner': 0, 'Branch Manager': 0 };
  users.forEach(u => {
    const r = (u.role === 'Document Officer' || u.role === 'Internal User') ? 'Documentation Officer' : u.role;
    if (counts.hasOwnProperty(r)) counts[r]++;
  });
  setText('um-count-superadmin', counts['Super Admin']);
  setText('um-count-admin', counts['Admin']);
  setText('um-count-internal', counts['Documentation Officer']);
  setText('um-count-app', counts['Application User']);
  setText('um-count-partner', counts['Channel Partner']);
  setText('um-count-branch', counts['Branch Manager']);
}

function umFilteredUsers() {
  const q = (document.getElementById('um-search-input')?.value || '').toLowerCase().trim();
  const roleFilter = document.getElementById('um-role-filter')?.value || '';
  return (window.__allUsers || []).filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!q) return true;
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });
}

function renderUsersTable() {
  const tbody = document.getElementById('um-table-body');
  if (!tbody) return;

  const filtered = umFilteredUsers();
  const rowsPerPage = parseInt(document.getElementById('um-rows-per-page')?.value || '10', 10);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  if (umCurrentPage > totalPages) umCurrentPage = totalPages;
  const start = (umCurrentPage - 1) * rowsPerPage;
  const pageRows = filtered.slice(start, start + rowsPerPage);

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No users found.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map(u => {
      const roleColor = UM_ROLE_COLORS[u.role] || { bg: '#F1F5F9', fg: '#475569' };
      const isActive = (u.status || 'Active') === 'Active';
      const avColor = umAvatarColor(u.name);
      return `
        <tr>
          <td>
            <div class="um-name-cell">
              <div class="um-avatar" style="background:${avColor}1A;color:${avColor}">${umInitials(u.name)}</div>
              <span class="um-name-text">${(u.name || 'Unnamed').replace(/</g, '&lt;')}</span>
            </div>
          </td>
          <td>${(u.email || '—').replace(/</g, '&lt;')}</td>
          <td><span class="um-role-pill" style="background:${roleColor.bg};color:${roleColor.fg}">${u.role || 'Unassigned'}</span></td>
          <td>
            <span class="um-status-wrap${isActive ? '' : ' inactive'}">
              <select onchange="changeUserStatus('${u.id}', this.value)">
                <option value="Active" ${isActive ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${!isActive ? 'selected' : ''}>Inactive</option>
              </select>
            </span>
          </td>
          <td>${umFmtDate(u.createdAt)}</td>
          <td>${umFmtDate(u.lastLogin)}</td>
          <td style="text-align:center;position:relative">
            <button class="um-actions-btn" onclick="umToggleActionsMenu(event,'${u.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <div class="um-actions-menu" id="um-menu-${u.id}">
              <div onclick="openAddUserModal('${u.id}')">Edit user</div>
              <div class="danger" onclick="deleteUser('${u.id}')">Delete user</div>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  setText('um-range-label', filtered.length
    ? `${start + 1}–${Math.min(start + rowsPerPage, filtered.length)} of ${filtered.length} records`
    : '0 records');

  umRenderPager(totalPages);
}

function umRenderPager(totalPages) {
  const pager = document.getElementById('um-pager');
  if (!pager) return;
  let html = `<button ${umCurrentPage === 1 ? 'disabled' : ''} onclick="umGoToPage(${umCurrentPage - 1})">‹ Previous</button>`;
  const maxBtns = 3;
  let from = Math.max(1, umCurrentPage - 1);
  let to = Math.min(totalPages, from + maxBtns - 1);
  from = Math.max(1, to - maxBtns + 1);
  for (let p = from; p <= to; p++) {
    html += `<button class="${p === umCurrentPage ? 'active' : ''}" onclick="umGoToPage(${p})">${p}</button>`;
  }
  html += `<button ${umCurrentPage === totalPages ? 'disabled' : ''} onclick="umGoToPage(${umCurrentPage + 1})">Next ›</button>`;
  pager.innerHTML = html;
}

function umGoToPage(p) {
  umCurrentPage = p;
  renderUsersTable();
}

function umChangeRowsPerPage() {
  umCurrentPage = 1;
  renderUsersTable();
}

function umToggleActionsMenu(evt, userId) {
  evt.stopPropagation();
  document.querySelectorAll('#view-users .um-actions-menu.open').forEach(m => {
    if (m.id !== `um-menu-${userId}`) m.classList.remove('open');
  });
  const menu = document.getElementById(`um-menu-${userId}`);
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('#view-users .um-actions-menu.open').forEach(m => m.classList.remove('open'));
});

let __editingUserId = null;

function openAddUserModal(userId) {
  if (!checkAccess(['Super Admin', 'Admin'])) return;
  __editingUserId = userId || null;
  const existing = userId ? (window.__allUsers || []).find(u => u.id === userId) : null;

  document.getElementById('user-modal-title').textContent = existing ? 'Edit User' : 'Add User';
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('um-name').value = existing?.name || '';
  document.getElementById('um-email').value = existing?.email || '';
  document.getElementById('um-email').disabled = !!existing; // email immutable once created
  document.getElementById('um-role').value = existing?.role || 'Application User';
  document.getElementById('um-status').value = existing?.status || 'Active';
  document.getElementById('um-partner-id').value = existing?.partnerId || '';
  toggleUmPartnerRow();

  document.getElementById('user-modal-overlay').style.display = 'flex';
  document.querySelectorAll('#view-users .um-actions-menu.open').forEach(m => m.classList.remove('open'));
}

function closeUserModal() {
  document.getElementById('user-modal-overlay').style.display = 'none';
  document.getElementById('um-email').disabled = false;
  __editingUserId = null;
}

function toggleUmPartnerRow() {
  const role = document.getElementById('um-role')?.value;
  const row = document.getElementById('um-partner-row');
  if (row) row.style.display = role === 'Channel Partner' ? 'block' : 'none';
}

async function submitUserForm() {
  const errEl  = document.getElementById('user-modal-error');
  const btn    = document.getElementById('um-submit-btn');
  const lbl    = document.getElementById('um-submit-lbl');
  const spin   = document.getElementById('um-submit-spin');
  errEl.style.display = 'none';

  const name   = document.getElementById('um-name').value.trim();
  const email  = document.getElementById('um-email').value.trim();
  const role   = document.getElementById('um-role').value;
  const status = document.getElementById('um-status').value;
  const partnerId = document.getElementById('um-partner-id').value.trim();

  if (!name || !email) {
    errEl.textContent = 'Name and email are required.';
    errEl.style.display = 'block';
    return;
  }
  if (role === 'Channel Partner' && !partnerId) {
    errEl.textContent = 'Partner ID is required for the Channel Partner role.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  lbl.textContent = 'Saving…';
  spin.style.display = 'inline-block';

  try {
    const payload = { name, email, role, status };
    if (role === 'Channel Partner') payload.partnerId = partnerId;

    if (__editingUserId) {
      await db.collection('users').doc(__editingUserId).set(payload, { merge: true });
      if (typeof logActivity === 'function') logActivity('Edit', 'User', __editingUserId);
      toast('User updated ', 'success');
    } else {
      // Duplicate-email guard
      const dup = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!dup.empty) {
        errEl.textContent = 'A user with this email already exists.';
        errEl.style.display = 'block';
        return;
      }
      const newUserRef = await db.collection('users').add({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: window.staff?.name || 'CRM',
        lastLogin: null
      });
      if (typeof logActivity === 'function') logActivity('Add', 'User', newUserRef.id);
      if (typeof createSystemNotification === 'function') {
        createSystemNotification('user_added', {
          message: `${name} (${email}) was added as ${role} by ${window.staff?.name || 'CRM'}.`
        });
      }
      toast('User created ', 'success');
    }
    // No manual re-render needed — the users onSnapshot listener in
    // initUsersListener() will pick up the change and call renderUsersTable().
    closeUserModal();
  } catch (e) {
    console.error('[submitUserForm] error:', e);
    errEl.textContent = 'Save failed: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    lbl.textContent = 'Save User';
    spin.style.display = 'none';
  }
}

async function changeUserStatus(userId, newStatus) {
  if (!checkAccess(['Super Admin', 'Admin'])) { renderUsersTable(); return; }
  try {
    await db.collection('users').doc(userId).set({ status: newStatus }, { merge: true });
    toast(`Status updated to ${newStatus}`, 'success');
  } catch (err) {
    console.error('changeUserStatus error:', err);
    toast('Failed to update status', 'error');
  }
}

async function deleteUser(userId) {
  if (!checkAccess(['Super Admin', 'Admin'])) return;
  const u = (window.__allUsers || []).find(x => x.id === userId);
  if (!confirm(`Delete user "${u?.name || u?.email || userId}"? This cannot be undone.`)) return;
  try {
    await db.collection('users').doc(userId).delete();
    if (typeof logActivity === 'function') logActivity('Delete', 'User', userId);
    if (typeof createSystemNotification === 'function') {
      createSystemNotification('user_deleted', {
        message: `${u?.name || u?.email || userId} was deleted by ${window.staff?.name || 'Staff'}.`
      });
    }
    toast('User deleted', 'success');
  } catch (err) {
    console.error('deleteUser error:', err);
    toast('Failed to delete user', 'error');
  }
}

console.log('[script-additions.js] User Management module loaded');
