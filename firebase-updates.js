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
}

/* ═══════════════════════════════════════════════════════
   0. ADD STUDENT MODAL — Cloudinary config, file state,
      upload functions, and modal open/close.
      (Consolidated here so everything the Add Student
      flow depends on lives in one module.)
═══════════════════════════════════════════════════════ */
const CLOUDINARY_CLOUD_NAME = 'dv9emyzlg';
const CLOUDINARY_UPLOAD_PRESET = 'fdtrmpus';

let asSelectedFiles = []; // Files currently staged in the Add Student modal

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
   'as-level','as-course','as-university','as-agent','as-submitted-by','as-notes']
   .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  asSelectedFiles = [];
  renderAsFileList();
}

/* ═══════════════════════════════════════════════════════
   1. PIPELINE STAGES — Save drawer
═══════════════════════════════════════════════════════ */
async function saveStages() {
  if (!Object.keys(stageEdits || {}).length) {
    closeDrawer('drw-stage');
    return;
  }

  const s = (window.students || []).find(s => s['STUDENT ID'] === activeStudentId);
  if (!s) return;

  const txtEl  = document.getElementById('stage-save-txt');
  const spinEl = document.getElementById('stage-save-spin');
  if (txtEl)  txtEl.textContent    = 'Saving…';
  if (spinEl) spinEl.style.display = '';

  // Build patch from stageEdits
  const patch = {};
  Object.values(stageEdits).forEach(e => { if (e.val) patch[e.key] = e.val; });

  // Optimistic local update first
  Object.assign(s, patch);
  if (typeof filterTableStudents    === 'function') filterTableStudents();
  if (typeof updateStats            === 'function') updateStats();
  if (typeof updateFunnel           === 'function') updateFunnel();
  if (typeof renderDashboardPartners === 'function') renderDashboardPartners();
  if (currentView === 'student-detail' && detailStudentId === activeStudentId) {
    if (typeof openDetail === 'function') openDetail(activeStudentId);
  }

  try {
    await fbUpdateStudent(activeStudentId, patch);
    toast('Pipeline updated ✅', 'success');
  } catch (e) {
    console.error('[saveStages] Firestore error:', e);
    toast('Saved locally — sync failed: ' + e.message, 'info');
  } finally {
    if (txtEl)  txtEl.textContent    = 'Save changes';
    if (spinEl) spinEl.style.display = 'none';
    closeDrawer('drw-stage');
    window.stageEdits = {};
  }
}

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
  .then(() => toast('✓ Saved', 'success'))
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
  .then(() => toast('✓ Saved', 'success'))
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
  const agent       = get('as-agent');
  const submittedBy = get('as-submitted-by') || window.staff?.name || '';
  const notes       = get('as-notes');

  // Required field validation
  const missing = [];
  if (!name)  missing.push('Full Name');
  if (!sid)   missing.push('Student ID');
  if (!level) missing.push('Level');
  if (!course) missing.push('Course');

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
        uploadedDocs = await uploadAllAsFiles();
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
      documents      : uploadedDocs,   // [{name, url, type, uploadedAt}]
      createdAt      : firebase.firestore.FieldValue.serverTimestamp(),
      createdBy      : window.staff?.name || 'CRM'
    };

    /* ── STEP 3: Save to Firestore ── */
    await db.collection('students').doc(sid).set(newStudent);

    // Local cache prepend
    window.students = [{ id: sid, ...newStudent }, ...(window.students || [])];

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
═══════════════════════════════════════════════════════ */
async function submitCASUpdate() {
  const get = id => document.getElementById(id)?.value || '';

  const updateData = {
    'Ready for PCI'                                         : get('cup-pci'),
    'Visa Refusal Y/N'                                      : get('cup-visa-r'),
    'Information check on CAS Shield completed? Y/N'        : get('cup-info'),
    'Pre-CAS questionnaire on CAS shield Completed? Y/N'    : get('cup-precas'),
    'Study Gap Y/N'                                         : get('cup-gap'),
    'Same Level Studies Y/N'                                : get('cup-same'),
    'PCI Invite'                                            : get('cup-invite'),
    'Team Comment'                                          : get('cup-comment'),
    applicantId : window.activeCASId,
    updatedBy   : window.staff?.name || 'Staff',
    updatedAt   : firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (typeof loading === 'function') loading('Saving CAS record…');

    await db.collection('cas_shield').doc(window.activeCASId).set(updateData, { merge: true });

    // Local cache update
    const row = (window.casData || []).find(r => r['Applicant ID'] === window.activeCASId);
    if (row) Object.assign(row, updateData);

    if (typeof filterCAS === 'function') filterCAS();
    closeDrawer('drw-cas-update');
    toast('CAS record updated ✅', 'success');

  } catch (e) {
    console.error('[submitCASUpdate] Error:', e);
    toast('Update failed: ' + e.message, 'error');
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
}

/* ═══════════════════════════════════════════════════════
   5. NOTIFICATION / EMAIL SEND (Google Script jhandai)
═══════════════════════════════════════════════════════ */
async function sendNotification() {
  const role    = document.getElementById('notify-role')?.value;
  const type    = document.getElementById('notify-type')?.value;
  const subject = document.getElementById('notify-subject')?.value?.trim();
  const message = document.getElementById('notify-message')?.value?.trim();

  if (!subject || !message) { toast('Fill in subject and message', 'error'); return; }

  const btn = document.getElementById('notify-send-btn');
  if (btn) btn.disabled = true;

  try {
    // Log notification to Firestore (audit trail)
    await db.collection('notifications').add({
      studentId  : window.detailStudentId || null,
      role, type, subject, message,
      sentBy     : window.staff?.name || 'Staff',
      sentAt     : firebase.firestore.FieldValue.serverTimestamp()
    });

    toast('Notification logged ✅', 'success');
    closeDrawer('drw-notify');
  } catch (e) {
    console.error('[sendNotification] Error:', e);
    toast('Failed: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   6. DELETE STUDENT (Admin only)
═══════════════════════════════════════════════════════ */
async function deleteStudent(studentId) {
  if (window.staff?.role !== 'Admin') {
    toast('Only admins can delete students', 'error');
    return;
  }
  if (!confirm(`Delete student "${studentId}"? This cannot be undone.`)) return;

  try {
    await db.collection('students').doc(studentId).delete();
    window.students = (window.students || []).filter(s => s['STUDENT ID'] !== studentId);
    if (typeof filterTableStudents === 'function') filterTableStudents();
    if (typeof updateStats         === 'function') updateStats();
    if (typeof updateFunnel        === 'function') updateFunnel();
    toast('Student deleted', 'success');
    if (typeof backToDashboard === 'function') backToDashboard();
  } catch (e) {
    console.error('[deleteStudent] Error:', e);
    toast('Delete failed: ' + e.message, 'error');
  }
}

/* ─── Date helper ─── */
function today() {
  return new Date().toISOString().slice(0, 10);
}

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
window.loadStudentsFromFirebase = function() {
  if (typeof loading === 'function') loading('Connecting to live student stream…');

  if (typeof window._studentsUnsubscribe === 'function') {
    window._studentsUnsubscribe();
    window._studentsUnsubscribe = null;
  }

  let query = db.collection('students');
  if (window.staff && window.staff.role === 'Channel Partner' && window.staff.partnerId) {
    query = query.where('partnerId', '==', window.staff.partnerId);
  } else {
    query = query.orderBy('createdAt', 'desc');
  }

  return new Promise((resolve) => {
    let firstLoad = true;

    window._studentsUnsubscribe = query.onSnapshot(snapshot => {
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
        firstLoad = false;
        resolve();
      }

      console.log('[Reactive Firestore Stream] students synced:', fetched.length);
    }, error => {
      console.error('[loadStudentsFromFirebase] onSnapshot error:', error);
      window.studentsDataReady = false;
      document.dispatchEvent(new CustomEvent('students-data-error', { detail: { error } }));
      if (typeof toast === 'function') toast('Real-time student stream disconnected: ' + error.message, 'error');
      if (typeof hideLoading === 'function') hideLoading();
      resolve();
    });
  });
};

// Override the default loadStudents to use the reactive Firebase stream
window.loadStudents = window.loadStudentsFromFirebase;

/* ═══════════════════════════════════════════════════════
   7b. CHANNEL PARTNERS — Real-time count for dashboard KPI
═══════════════════════════════════════════════════════ */
window.channelPartners = [];
window._partnersUnsubscribe = null;

window.loadChannelPartnersFromFirebase = function() {
  if (typeof window._partnersUnsubscribe === 'function') {
    window._partnersUnsubscribe();
    window._partnersUnsubscribe = null;
  }
  window._partnersUnsubscribe = db.collection('channelPartners').onSnapshot(snapshot => {
    const fetched = [];
    snapshot.forEach(doc => fetched.push({ id: doc.id, ...doc.data() }));
    window.channelPartners = fetched;
    window.totalPartners = fetched.length;
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof setText === 'function') setText('kpi-partners', fetched.length);
    console.log('[Reactive Firestore Stream] channelPartners synced:', fetched.length);
  }, error => {
    console.error('[loadChannelPartnersFromFirebase] onSnapshot error:', error);
  });
};

document.addEventListener('students-data-ready', function onceInit() {
  if (typeof window.loadChannelPartnersFromFirebase === 'function' && !window._partnersUnsubscribe) {
    window.loadChannelPartnersFromFirebase();
  }
});

/* ═══════════════════════════════════════════════════════
   8. CAS SHIELD — Load from Firestore
   (Canonical definition — do NOT duplicate elsewhere.)
═══════════════════════════════════════════════════════ */
window.casDataReady = false;

window.loadCAS = async function() {
  if (typeof loading === 'function') loading('Fetching CAS Shield…');

  try {
    const snapshot = await db.collection('cas_shield').get();

    const fetched = [];
    snapshot.forEach(doc => {
      fetched.push({ id: doc.id, ...doc.data() });
    });

    window.casData = fetched;
    window.casDataReady = true;

    if (typeof renderCAS === 'function') {
      renderCAS(fetched);
    } else {
      console.warn('[loadCAS] renderCAS() is not defined — CAS data loaded but UI was not updated.');
    }

    document.dispatchEvent(new CustomEvent('cas-data-ready', { detail: { count: fetched.length } }));

    if (typeof toast === 'function') {
      toast(fetched.length ? `CAS Shield loaded — ${fetched.length} record(s)` : 'CAS Shield loaded — no records found', 'success');
    }

  } catch (e) {
    console.error('[loadCAS] Firestore error:', e);
    window.casDataReady = false;
    window.casData = window.casData || [];

    document.dispatchEvent(new CustomEvent('cas-data-error', { detail: { error: e } }));

    if (typeof toast === 'function') {
      toast('Could not load CAS Shield: ' + e.message, 'error');
    }

    const tbody = document.getElementById('cas-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-state">Could not load CAS Shield data. Try refreshing.</td></tr>';
    }

  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
};

console.log('[firebase-updates.js] loaded ✅');
