/* ═══════════════════════════════════════════════════════
   FIREBASE UPDATES  ·  Route2Uni CRM Portal
   All Firestore write operations:
   · Pipeline stage save
   · Inline field edit
   · Add new student
   · CAS Shield update
   Plus: data loaders for students & CAS Shield
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   HELPER — Automatic system notifications
   Writes a doc into the existing 'notifications' collection
   so the real-time listener (initNotificationsListener, below)
   picks it up the same way manual "Send Notification" entries
   do. event is one of:
     student_added | student_updated | student_deleted |
     user_added | user_deleted | document_uploaded
═══════════════════════════════════════════════════════ */
async function createSystemNotification(event, opts = {}) {
  if (!window.db) return;
  const LABELS = {
    student_added     : 'Student Added',
    student_updated   : 'Student Updated',
    student_deleted   : 'Student Deleted',
    user_added        : 'User Added',
    user_deleted      : 'User Deleted',
    document_uploaded : 'Document Uploaded'
  };
  const subject = opts.subject || LABELS[event] || 'System update';
  try {
    await db.collection('notifications').add({
      studentId : opts.studentId || null,
      partnerId : opts.partnerId || null,
      role      : opts.role || 'Staff',
      type      : 'System',
      event,
      subject,
      message   : opts.message || subject,
      system    : true,
      sentBy    : window.staff?.name || 'System',
      sentAt    : firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    // Never block the primary action (add/update/delete) on a
    // notification write failing — just log it.
    console.error('[createSystemNotification] failed for event "' + event + '":', e);
  }
}
window.createSystemNotification = createSystemNotification;

/* ═══════════════════════════════════════════════════════
   HELPER — Student patch update
═══════════════════════════════════════════════════════ */
async function fbUpdateStudent(studentId, patch) {
  await db.collection('students').doc(studentId).set(
    {
      ...patch,
      updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy : window.staff?.name || 'Staff'
    },
    { merge: true }
  );
  // Local cache update
  const s = (window.students || []).find(s => s['STUDENT ID'] === studentId);
  if (s) Object.assign(s, patch);

  createSystemNotification('student_updated', {
    studentId,
    partnerId: s?.partnerId || null,
    message: `${s?.['STUDENT NAME'] || studentId} was updated by ${window.staff?.name || 'Staff'}.`
  });
}

/* ═══════════════════════════════════════════════════════
   0. ADD STUDENT MODAL — Cloudinary config, file state,
      upload functions, and modal open/close.
      (Consolidated here so everything the Add Student
      flow depends on lives in one module.)
═══════════════════════════════════════════════════════ */
let asSelectedFiles = []; // Files currently staged in the Add Student modal

// BUGFIX: this used to call the old uploadFileToCloudinary(), which posted
// files to a public, unauthenticated Cloudinary upload preset — bypassing
// Firebase Storage security/auth rules entirely. firebase-storage-upload.js
// (uploadFileToStorage) was built as the replacement but was never actually
// wired in here. Now it is.
async function uploadAllAsFiles(studentId) {
  const uploaded = [];
  for (const file of asSelectedFiles) {
    const result = await uploadFileToStorage(file, studentId, 'general');
    uploaded.push({
      name      : result.name,
      url       : result.url,
      path      : result.path,       // needed by deleteFileFromStorage() later
      type      : result.type,
      uploadedAt: new Date().toISOString()
    });
  }
  return uploaded;
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

function openAddStudent() {
  asSelectedFiles = [];
  renderAsFileList();
  document.getElementById('as-error').style.display = 'none';
  document.getElementById('as-success').style.display = 'none';
  document.getElementById('add-student-overlay').style.display = 'block';
}

function closeAddStudent() {
  document.getElementById('add-student-overlay').style.display = 'none';
  ['as-name','as-id','as-dob','as-nationality','as-mobile','as-email',
   'as-level','as-course','as-university','as-agent','as-agent-manual','as-submitted-by','as-notes']
   .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const manual = document.getElementById('as-agent-manual');
  if (manual) manual.style.display = 'none';
  asSelectedFiles = [];
  renderAsFileList();
}

/* ═══════════════════════════════════════════════════════
   1. PIPELINE STAGES — Save drawer
   CLEANUP: the real, active saveStages() lives in
   script-additions.js. This file used to also define one,
   but since script-additions.js loads after this file, that
   copy always won and this one was dead code. Removed.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   2. INLINE FIELD EDIT
   script.js ko queueFieldEdit lai replace garcha
═══════════════════════════════════════════════════════ */
window.queueFieldEdit = function (studentId, field, value) {
  // Local cache update
  const s = (window.students || []).find(s => s['STUDENT ID'] === studentId);
  if (s) s[field] = value;

  // Firestore update (fire and forget with error toast)
  db.collection('students').doc(studentId).set(
    {
      [field]    : value,
      updatedAt  : firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy  : window.staff?.name || 'Staff'
    },
    { merge: true }
  )
  .then(() => {
    toast('✓ Saved', 'success');
    createSystemNotification('student_updated', {
      studentId,
      partnerId: s?.partnerId || null,
      message: `${s?.['STUDENT NAME'] || studentId} was updated by ${window.staff?.name || 'Staff'}.`
    });
  })
  .catch(e => {
    console.error('[queueFieldEdit] Firestore error:', e);
    toast('Sync failed: ' + e.message, 'error');
  });
};

window.queueBatchEdit = function (studentId, fieldsMap) {
  if (!fieldsMap || !Object.keys(fieldsMap).length) return;

  // Local cache update
  const s = (window.students || []).find(s => s['STUDENT ID'] === studentId);
  if (s) Object.assign(s, fieldsMap);

  // Single Firestore call for all fields
  db.collection('students').doc(studentId).set(
    {
      ...fieldsMap,
      updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy : window.staff?.name || 'Staff'
    },
    { merge: true }
  )
  .then(() => {
    toast('✓ Saved', 'success');
    createSystemNotification('student_updated', {
      studentId,
      partnerId: s?.partnerId || null,
      message: `${s?.['STUDENT NAME'] || studentId} was updated by ${window.staff?.name || 'Staff'}.`
    });
  })
  .catch(e => {
    console.error('[queueBatchEdit] Firestore error:', e);
    toast('Sync failed: ' + e.message, 'error');
  });
};

/* ─── Disable old Google Script queue flush ─── */
window.flushSaveQueueNow = function () {
  return Promise.resolve(); // Firestore directly save garcha — queue chaindaina
};

/* ═══════════════════════════════════════════════════════
   3. ADD NEW STUDENT  (Cloudinary file upload integrated)
═══════════════════════════════════════════════════════ */
async function submitAddStudent() {
  const btnEl    = document.getElementById('as-submit-btn');
  const lblEl    = document.getElementById('as-submit-lbl');
  const spinEl   = document.getElementById('as-submit-spin');
  const errEl    = document.getElementById('as-error');
  const successEl = document.getElementById('as-success');

  errEl.style.display     = 'none';
  successEl.style.display = 'none';

  // Read form values
  const get = id => (document.getElementById(id)?.value || '').trim();
  const name        = get('as-name');
  const sid         = get('as-id');
  const dob         = get('as-dob');
  const level       = get('as-level');
  const course      = get('as-course');
  const nationality = get('as-nationality');
  const mobile      = get('as-mobile');
  const email       = get('as-email');
  const university  = get('as-university');

  // Channel Partner / Agent — the field is a dropdown of window.channelPartners
  // (populated by populatePartnerDropdown() in script-additions.js). Its value
  // is the partner's Firestore doc id, "__other__" for the free-text fallback,
  // or "" if nothing was picked. Resolve that into a readable name (AGENT) and
  // keep the real partnerId link alongside it.
  const agentSelVal = get('as-agent');
  let agent = '';
  let partnerId = null;
  if (agentSelVal === '__other__') {
    agent = get('as-agent-manual');
  } else if (agentSelVal) {
    const matchedPartner = (window.channelPartners || []).find(p => p.id === agentSelVal);
    agent = matchedPartner?.name || agentSelVal;
    partnerId = agentSelVal;
  }

  const submittedBy = get('as-submitted-by') || window.staff?.name || '';
  const notes       = get('as-notes');

  // Required field validation
  const missing = [];
  if (!name)  missing.push('Full Name');
  if (!sid)   missing.push('Student ID');
  if (!level) missing.push('Level');
  if (!course) missing.push('Course');

  // Guard against submitting mid-generation (generateStudentId() is async;
  // this only matters if someone clicks Add Student in the first instant
  // after opening the modal, before the id field finishes filling in).
  if (sid === 'Generating…') {
    errEl.textContent   = 'Student ID is still generating — try again in a second.';
    errEl.style.display = 'block';
    return;
  }

  if (missing.length) {
    errEl.textContent    = 'Please fill in: ' + missing.join(', ');
    errEl.style.display  = 'block';
    return;
  }

  // Loading state
  btnEl.disabled       = true;
  lblEl.textContent    = 'Saving…';
  spinEl.style.display = '';

  try {
    // Check duplicate
    const existing = await db.collection('students').doc(sid).get();
    if (existing.exists) {
      errEl.textContent   = `Student ID "${sid}" already exists. Use a different ID.`;
      errEl.style.display = 'block';
      btnEl.disabled       = false;
      lblEl.textContent    = 'Add Student';
      spinEl.style.display = 'none';
      return;
    }

    /* ── STEP 1: Upload files to Cloudinary (yedi files select gareko cha) ── */
    let uploadedDocs = [];
    if (typeof asSelectedFiles !== 'undefined' && asSelectedFiles.length > 0) {
      lblEl.textContent = 'Uploading files…';
      try {
        uploadedDocs = await uploadAllAsFiles(sid);
      } catch (uploadErr) {
        console.error('[submitAddStudent] File upload error:', uploadErr);
        errEl.textContent   = 'File upload failed: ' + uploadErr.message + ' (Student saved without files — try uploading again from detail page)';
        errEl.style.display = 'block';
        // File upload fail bhayepani student record save garne — block nagarne
      }
      lblEl.textContent = 'Saving…';
    }

    /* ── STEP 2: Build student object with documents array ── */
    const newStudent = {
      'STUDENT ID'   : sid,
      'STUDENT NAME' : name,
      'DOB'          : dob,
      'LEVEL'        : level,
      'COURSE'       : course,
      'NATIONALITY'  : nationality,
      'MOBILE'       : mobile,
      'EMAIL'        : email,
      'UNIVERSITY'   : university,
      'AGENT'        : agent,
      'SUBMITTED BY' : submittedBy,
      'NOTES'        : notes,
      'ADDED DATE'   : new Date().toISOString().slice(0, 10),
      'ADDED BY'     : window.staff?.name || 'CRM',
      partnerId      : partnerId,      // links to channelPartners/{id} — matches
                                        // the field Channel Partner logins are
                                        // scoped/filtered by elsewhere in the app
      documents      : uploadedDocs,   // [{name, url, type, uploadedAt}]
      createdAt      : firebase.firestore.FieldValue.serverTimestamp(),
      createdBy      : window.staff?.name || 'CRM'
    };

    /* ── STEP 3: Save to Firestore ── */
    await db.collection('students').doc(sid).set(newStudent);

    // Local cache prepend
    window.students = [{ id: sid, ...newStudent }, ...(window.students || [])];

    // Auto-notifications: student added, plus a separate one if files came with it
    createSystemNotification('student_added', {
      studentId: sid,
      message: `${name} (${sid}) was added by ${window.staff?.name || 'CRM'}.`
    });
    if (uploadedDocs.length) {
      createSystemNotification('document_uploaded', {
        studentId: sid,
        message: `${uploadedDocs.length} document(s) uploaded for ${name} (${sid}).`
      });
    }

    // UI refresh
    if (typeof filterTableStudents    === 'function') filterTableStudents();
    if (typeof updateStats            === 'function') updateStats();
    if (typeof updateFunnel           === 'function') updateFunnel();
    if (typeof renderDashboardPartners === 'function') renderDashboardPartners();

    // Success display
    const docCountMsg = uploadedDocs.length
      ? ` · ${uploadedDocs.length} document(s) uploaded`
      : '';
    document.getElementById('as-success-detail').textContent =
      `${name} (${sid}) added successfully.${docCountMsg}`;
    document.getElementById('as-drive-link-wrap').style.display = 'none';
    successEl.style.display = 'block';
    lblEl.textContent       = '✓ Added';
    toast(`${name} added ✅`, 'success');

    // Reset selected files for next entry
    if (typeof asSelectedFiles !== 'undefined') asSelectedFiles = [];
    if (typeof renderAsFileList === 'function') renderAsFileList();

    // Auto close
    setTimeout(() => closeAddStudent(), 2500);

  } catch (e) {
    console.error('[submitAddStudent] Error:', e);
    errEl.textContent   = 'Error: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btnEl.disabled       = false;
    if (lblEl.textContent === 'Saving…' || lblEl.textContent === 'Uploading files…') lblEl.textContent = 'Add Student';
    spinEl.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════════════
   4. CAS SHIELD UPDATE
   CLEANUP: the real, active submitCASUpdate() lives in
   script-additions.js and correctly writes CAS fields onto
   the student document (matching what the CAS Shield table
   reads). This file's old copy wrote to a separate,
   never-read 'cas_shield' collection and was shadowed dead
   code — removed.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   5. NOTIFICATION / EMAIL SEND
   CLEANUP: the real, active sendNotification() lives in
   script-additions.js. Removed the shadowed duplicate.
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   6. DELETE STUDENT (Admin only)
═══════════════════════════════════════════════════════ */
async function deleteStudent(studentId) {
  // BUGFIX: was a strict `role !== 'Admin'` check, which excluded Super Admin
  // even though every other permission check in the app treats Super Admin
  // as senior to Admin. Use the same hierarchy-aware checkAccess() everything
  // else uses.
  if (!checkAccess(['Super Admin', 'Admin'])) {
    toast('Only admins can delete students', 'error');
    return;
  }
  if (!confirm(`Delete student "${studentId}"? This cannot be undone.`)) return;

  try {
    const s = (window.students || []).find(s => s['STUDENT ID'] === studentId);
    await db.collection('students').doc(studentId).delete();
    window.students = (window.students || []).filter(s => s['STUDENT ID'] !== studentId);
    if (typeof filterTableStudents === 'function') filterTableStudents();
    if (typeof updateStats         === 'function') updateStats();
    if (typeof updateFunnel        === 'function') updateFunnel();
    createSystemNotification('student_deleted', {
      studentId,
      partnerId: s?.partnerId || null,
      message: `${s?.['STUDENT NAME'] || studentId} was deleted by ${window.staff?.name || 'Staff'}.`
    });
    toast('Student deleted', 'success');
    if (typeof backToDashboard === 'function') backToDashboard();
  } catch (e) {
    console.error('[deleteStudent] Error:', e);
    toast('Delete failed: ' + e.message, 'error');
  }
}

/* ─── today() helper: canonical definition lives in script-additions.js ─── */

/* ═══════════════════════════════════════════════════════
   7. STUDENTS — Load from Firestore
   (Canonical definition — do NOT duplicate elsewhere.
   firebase-auth.js's bootSession() calls and awaits this.)
═══════════════════════════════════════════════════════ */
window.studentsDataReady = false;
window._studentsUnsubscribe = null;

// Reactive real-time listener — replaces one-shot .get() fetch.
// Any add/update/delete on the 'students' collection auto-refreshes
// every dependent surface (KPIs, funnel, charts, tables, follow-up, CAS).
window.showErrorBanner = function(msg) {
  const banner = document.getElementById('data-error-banner');
  const msgEl = document.getElementById('data-error-banner-msg');
  if (msgEl) msgEl.textContent = msg;
  if (banner) banner.style.display = 'flex';
};

window.hideErrorBanner = function() {
  const banner = document.getElementById('data-error-banner');
  if (banner) banner.style.display = 'none';
};

window.loadStudentsFromFirebase = function() {
  if (typeof loading === 'function') loading('Connecting to live student stream…');

  let query = db.collection('students');
  if (window.staff && window.staff.role === 'Channel Partner' && window.staff.partnerId) {
    query = query.where('partnerId', '==', window.staff.partnerId);
  } else {
    query = query.orderBy('createdAt', 'desc');
  }

  return new Promise((resolve) => {
    let firstLoad = true;

    window.ListenerManager.register('students', () => query.onSnapshot(snapshot => {
      const fetched = [];
      snapshot.forEach(doc => fetched.push({ id: doc.id, ...doc.data() }));

      window.students = fetched;
      window.totalRecords = fetched.length;
      window.studentsDataReady = true;

      document.dispatchEvent(new CustomEvent('students-data-ready', { detail: { count: fetched.length } }));

      // Auto-refresh every active surface in real time
      if (typeof filterTableStudents === 'function') filterTableStudents();
      if (typeof updateStats === 'function') updateStats();
      if (typeof updateFunnel === 'function') updateFunnel();
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof renderFollowUp === 'function') renderFollowUp();
      if (typeof renderReports === 'function') renderReports();
      if (typeof renderCASTable === 'function' && Array.isArray(window.casRows)) {
        window.casRows = fetched;
        renderCASTable(fetched);
      }

      if (firstLoad) {
        if (typeof toast === 'function') toast('Live: ' + fetched.length + ' students synced', 'success');
        if (typeof hideLoading === 'function') hideLoading();
        if (typeof window.hideErrorBanner === 'function') window.hideErrorBanner();
        firstLoad = false;
        resolve();
      }

      console.log('[Reactive Firestore Stream] students synced:', fetched.length);
    }, error => {
      console.error('[loadStudentsFromFirebase] onSnapshot error:', error);
      window.studentsDataReady = false;
      document.dispatchEvent(new CustomEvent('students-data-error', { detail: { error } }));
      if (typeof toast === 'function') toast('Real-time student stream disconnected: ' + error.message, 'error');
      if (typeof window.showErrorBanner === 'function') window.showErrorBanner('Real-time student data disconnected: ' + error.message);
      if (typeof hideLoading === 'function') hideLoading();
      resolve();
    }));
  });
};

// Override the default loadStudents to use the reactive Firebase stream
window.loadStudents = window.loadStudentsFromFirebase;

/* ═══════════════════════════════════════════════════════
   7b. CHANNEL PARTNERS — Real-time count for dashboard KPI
═══════════════════════════════════════════════════════ */
window.channelPartners = [];

window.loadChannelPartnersFromFirebase = function() {
  window.ListenerManager.register('channelPartners', () => db.collection('channelPartners').onSnapshot(snapshot => {
    const fetched = [];
    snapshot.forEach(doc => fetched.push({ id: doc.id, ...doc.data() }));
    window.channelPartners = fetched;
    window.totalPartners = fetched.length;
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof setText === 'function') setText('kpi-partners', fetched.length);

    // Keep the dedicated Partners page grid and Reports page live too
    if (currentView === 'partners' && typeof renderPartnersGrid === 'function') renderPartnersGrid();
    if (currentView === 'reports' && typeof renderReports === 'function') renderReports();

    console.log('[Reactive Firestore Stream] channelPartners synced:', fetched.length);
  }, error => {
    console.error('[loadChannelPartnersFromFirebase] onSnapshot error:', error);
    if (typeof toast === 'function') toast('Channel partner stream disconnected: ' + error.message, 'error');
  }));
};

document.addEventListener('students-data-ready', function onceInit() {
  if (typeof window.loadChannelPartnersFromFirebase === 'function' && !window.ListenerManager.has('channelPartners')) {
    window.loadChannelPartnersFromFirebase();
  }
});

/* ═══════════════════════════════════════════════════════
   8. CAS SHIELD — Load from Firestore
   (Canonical definition — do NOT duplicate elsewhere.)
═══════════════════════════════════════════════════════ */
window.casDataReady = false;

window.loadCAS = function() {
  if (typeof loading === 'function') loading('Connecting to live CAS Shield stream…');

  return new Promise((resolve) => {
    let firstLoad = true;

    window.ListenerManager.register('cas_shield', () => db.collection('cas_shield').onSnapshot(snapshot => {
      const fetched = [];
      snapshot.forEach(doc => fetched.push({ id: doc.id, ...doc.data() }));

      window.casData = fetched;
      window.casDataReady = true;

      if (typeof renderCAS === 'function') {
        renderCAS(fetched);
      } else {
        console.warn('[loadCAS] renderCAS() is not defined — CAS data loaded but UI was not updated.');
      }

      document.dispatchEvent(new CustomEvent('cas-data-ready', { detail: { count: fetched.length } }));

      if (firstLoad) {
        if (typeof toast === 'function') {
          toast(fetched.length ? `CAS Shield loaded — ${fetched.length} record(s)` : 'CAS Shield loaded — no records found', 'success');
        }
        if (typeof hideLoading === 'function') hideLoading();
        firstLoad = false;
        resolve();
      }

      console.log('[Reactive Firestore Stream] cas_shield synced:', fetched.length);
    }, error => {
      console.error('[loadCAS] onSnapshot error:', error);
      window.casDataReady = false;
      window.casData = window.casData || [];

      document.dispatchEvent(new CustomEvent('cas-data-error', { detail: { error } }));

      if (typeof toast === 'function') {
        toast('CAS Shield stream disconnected: ' + error.message, 'error');
      }

      const tbody = document.getElementById('cas-table-body');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="empty-state">Could not load CAS Shield data. Try refreshing.</td></tr>';
      }

      if (typeof hideLoading === 'function') hideLoading();
      resolve();
    }));
  });
};

/* ═══════════════════════════════════════════════════════
   9. REAL-TIME NOTIFICATIONS
   Listens on 'notifications'. Channel Partners only see
   notifications addressed to their own partnerId; staff
   roles see the full live stream. Skips the initial batch
   so existing history doesn't toast-storm on page load —
   only newly-added docs trigger a toast.
═══════════════════════════════════════════════════════ */
window.__notificationsFirstLoad = true;
window.__unreadNotifCount = 0;

function updateNotifBadge(count) {
  window.__unreadNotifCount = count;
  const dot = document.querySelector('.notif-dot');
  if (!dot) return;
  dot.style.display = count > 0 ? '' : 'none';
  dot.style.background = count > 0 ? '#EF4444' : '';
  dot.setAttribute('data-count', count);
  dot.title = count > 0 ? `${count} new notification${count === 1 ? '' : 's'}` : '';
}

function initNotificationsListener() {
  if (!window.db || !window.staff) return;

  let query = db.collection('notifications').orderBy('sentAt', 'desc').limit(50);
  if (window.staff.role === 'Channel Partner' && window.staff.partnerId) {
    query = db.collection('notifications')
      .where('partnerId', '==', window.staff.partnerId)
      .orderBy('sentAt', 'desc')
      .limit(50);
  }

  window.__notificationsFirstLoad = true;
  window.ListenerManager.register('notifications', () => query.onSnapshot(snapshot => {
    if (window.__notificationsFirstLoad) {
      window.__notificationsFirstLoad = false;
      return;
    }
    let newCount = 0;
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        newCount++;
        const n = change.doc.data();
        if (typeof toast === 'function') toast(` ${n.subject || 'New notification'}`, 'info');
      }
    });
    if (newCount > 0) updateNotifBadge((window.__unreadNotifCount || 0) + newCount);
  }, err => {
    console.error('[initNotificationsListener] error:', err);
    if (typeof toast === 'function') toast('Notification stream disconnected: ' + err.message, 'error');
  }));
}

// Clears the unread badge when the user opens the notifications bell.
window.clearNotifBadge = function () {
  updateNotifBadge(0);
};
document.addEventListener('DOMContentLoaded', () => {
  const bell = document.querySelector('.hdr-icon-btn[title="Notifications"]');
  if (bell) bell.addEventListener('click', window.clearNotifBadge);
});

// Auto-start once the session is live (mirrors the channelPartners listener boot)
document.addEventListener('students-data-ready', function onceNotificationsInit() {
  if (typeof initNotificationsListener === 'function' && !window.ListenerManager.has('notifications')) {
    initNotificationsListener();
  }
});

/* ═══════════════════════════════════════════════════════
   10. STUDENT DETAIL — Personal Info inline edit
   Toggles the read-only "Personal Info" panel into editable
   inputs and saves via the existing queueBatchEdit() writer.
   Reuse this same id->key / toggle pattern for any other
   read-only panel you want to make editable.
═══════════════════════════════════════════════════════ */
const PERSONAL_INFO_FIELDS = [
  { id: 'dp-sid',       key: 'STUDENT ID',   locked: true },
  { id: 'dp-level',     key: 'LEVEL' },
  { id: 'dp-sname',     key: 'STUDENT NAME' },
  { id: 'dp-course',    key: 'COURSE' },
  { id: 'dp-dob',       key: 'DOB', type: 'date' },
  { id: 'dp-agent',     key: 'AGENT' },
  { id: 'dp-mobile-ro', key: 'MOBILE' },
  { id: 'dp-email-ro',  key: 'EMAIL', type: 'email' }
];
window.__personalInfoEditing = false;

function toggleEditPersonalInfo() {
  const btn = document.getElementById('dp-edit-btn');
  const s = (window.students || []).find(s => s['STUDENT ID'] === window.detailStudentId);
  if (!s || !btn) return;

  if (!window.__personalInfoEditing) {
    PERSONAL_INFO_FIELDS.forEach(f => {
      if (f.locked) return;
      const el = document.getElementById(f.id);
      if (!el) return;
      const val = (s[f.key] || '').toString().replace(/"/g, '&quot;');
      el.innerHTML = `<input class="form-control" style="font-size:12.5px;padding:4px 7px" type="${f.type || 'text'}" id="edit-${f.id}" value="${val}">`;
    });
    btn.textContent = ' Save';
    window.__personalInfoEditing = true;
  } else {
    const patch = {};
    PERSONAL_INFO_FIELDS.forEach(f => {
      if (f.locked) return;
      const input = document.getElementById('edit-' + f.id);
      if (input) patch[f.key] = input.value.trim();
    });
    if (typeof queueBatchEdit === 'function') queueBatchEdit(window.detailStudentId, patch);
    btn.textContent = ' Edit';
    window.__personalInfoEditing = false;
    setTimeout(() => { if (typeof openDetail === 'function') openDetail(window.detailStudentId); }, 250);
  }
}

console.log('[firebase-updates.js] loaded ');
