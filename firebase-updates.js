/* ═══════════════════════════════════════════════════════
   FIREBASE WRITE OPERATIONS v2
   Google Apps Script को सबै write calls replace गर्छ
═══════════════════════════════════════════════════════ */

/* ─── HELPER: Firestore मा student update ─── */
async function fbUpdateStudent(studentId, patch) {
  await db.collection('students').doc(studentId).set({
    ...patch,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: staff.name || 'Staff'
  }, { merge: true });
  const s = students.find(s => s['STUDENT ID'] === studentId);
  if (s) Object.assign(s, patch);
}

/* ─── 1. PIPELINE STAGES SAVE ─── */
async function saveStages() {
  if (!Object.keys(stageEdits).length) { closeDrawer('drw-stage'); return; }
  const s = students.find(s => s['STUDENT ID'] === activeStudentId);
  if (!s) return;
  const txt  = document.getElementById('stage-save-txt');
  const spin = document.getElementById('stage-save-spin');
  txt.textContent = 'Saving…'; spin.style.display = '';
  const patch = {};
  Object.values(stageEdits).forEach(e => { if (e.val) patch[e.key] = e.val; });
  Object.assign(s, patch);
  filterTableStudents(); updateStats(); updateFunnel(); renderDashboardPartners();
  if (currentView === 'student-detail' && detailStudentId === activeStudentId) openDetail(activeStudentId);
  try {
    await fbUpdateStudent(activeStudentId, patch);
    toast('Pipeline updated ✅', 'success');
  } catch (e) {
    toast('Saved locally, sync failed: ' + e.message, 'info');
  } finally {
    txt.textContent = 'Save changes'; spin.style.display = 'none';
    closeDrawer('drw-stage'); stageEdits = {};
  }
}

/* ─── 2. INLINE FIELD EDIT (queueFieldEdit override) ─── */
// script.js को queueFieldEdit → Firestore मा directly save गर्छ
window.queueFieldEdit = function(studentId, field, value) {
  // Local update
  const s = (window.students || []).find(s => s['STUDENT ID'] === studentId);
  if (s) s[field] = value;
  toast('✓ Saved', 'success');
  // Firestore मा save
  db.collection('students').doc(studentId).set({
    [field]: value,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: staff.name || 'Staff'
  }, { merge: true }).catch(e => {
    console.error('Field save error:', e);
    toast('Sync failed: ' + e.message, 'error');
  });
};

window.queueBatchEdit = function(sid, map) {
  Object.entries(map).forEach(([f, v]) => window.queueFieldEdit(sid, f, v));
};

/* ─── 3. flushQueue DISABLE (Google Script होइन अब) ─── */
// script.js को flushQueue लाई Firestore ले replace गर्यो
// यसलाई empty function बनाउँछु ताकि error नआओस्
window.flushSaveQueueNow = function() {
  return Promise.resolve(); // Firestore directly save गर्छ अब
};

/* ─── 4. ADD NEW STUDENT ─── */
async function submitAddStudent() {
  const btn       = document.getElementById('as-submit-btn');
  const lbl       = document.getElementById('as-submit-lbl');
  const spin      = document.getElementById('as-submit-spin');
  const errEl     = document.getElementById('as-error');
  const successEl = document.getElementById('as-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  const name        = document.getElementById('as-name').value.trim();
  const sid         = document.getElementById('as-id').value.trim();
  const dob         = document.getElementById('as-dob').value;
  const level       = document.getElementById('as-level').value;
  const course      = document.getElementById('as-course').value.trim();
  const nationality = document.getElementById('as-nationality').value.trim();
  const mobile      = document.getElementById('as-mobile').value.trim();
  const email       = document.getElementById('as-email').value.trim();
  const university  = document.getElementById('as-university').value.trim();
  const agent       = document.getElementById('as-agent').value.trim();
  const submittedBy = (document.getElementById('as-submitted-by').value || '').trim() || staff.name;
  const notes       = document.getElementById('as-notes').value.trim();

  if (!name || !sid || !level || !course) {
    errEl.textContent = 'Please fill in: Full Name, Student ID, Level, and Course.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true; lbl.textContent = 'Saving…'; spin.style.display = '';

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
    'ADDED DATE'   : today(),
    'ADDED BY'     : staff.name || 'CRM'
  };

  try {
    const existing = await db.collection('students').doc(sid).get();
    if (existing.exists) {
      errEl.textContent = `Student ID "${sid}" already exists!`;
      errEl.style.display = 'block';
      return;
    }
    await db.collection('students').doc(sid).set({
      ...newStudent,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: staff.name || 'CRM'
    });
    students.unshift(newStudent);
    filterTableStudents(); updateStats(); updateFunnel();
    document.getElementById('as-success-detail').textContent =
      `${name} (${sid}) added successfully.`;
    document.getElementById('as-drive-link-wrap').style.display = 'none';
    successEl.style.display = 'block';
    lbl.textContent = '✓ Added';
    toast(`${name} added ✅`, 'success');
    setTimeout(() => closeAddStudent(), 2500);
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    btn.disabled = false; lbl.textContent = 'Add Student'; spin.style.display = 'none';
  }
}

/* ─── 5. CAS SHIELD UPDATE ─── */
async function submitCASUpdate() {
  const u = {
    'Ready for PCI'                                       : document.getElementById('cup-pci').value,
    'Visa Refusal Y/N'                                    : document.getElementById('cup-visa-r').value,
    'Information check on CAS Shield completed? Y/N'     : document.getElementById('cup-info').value,
    'Pre-CAS questionnaire on CAS shield Completed? Y/N' : document.getElementById('cup-precas').value,
    'Study Gap Y/N'                                       : document.getElementById('cup-gap').value,
    'Same Level Studies Y/N'                              : document.getElementById('cup-same').value,
    'PCI Invite'                                          : document.getElementById('cup-invite').value,
    'Team Comment'                                        : document.getElementById('cup-comment').value,
    updatedBy: staff.name
  };
  try {
    loading('Saving CAS…');
    await db.collection('cas_shield').doc(activeCASId).set({
      ...u,
      applicantId: activeCASId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const r = casData.find(r => r['Applicant ID'] === activeCASId);
    if (r) Object.assign(r, u);
    filterCAS();
    closeDrawer('drw-cas-update');
    toast('CAS record updated ✅', 'success');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ─── 6. LOAD STUDENTS — Firestore बाट ─── */
async function loadStudents() {
  currentPage = 1; totalRecords = 0;
  loading('Loading students from Firestore…');
  try {
    await loadStudentsFromFirebase();
    toast('Loaded ' + students.length + ' students ✅', 'success');
  } catch (e) {
    toast('Load failed: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ─── 7. loadDashboardLazy OVERRIDE ─── */
// script.js को version Google Script बाट load गर्छ — यसले Firestore बाट गर्छ
window.loadDashboardLazy = async function() {
  loading('Loading dashboard…');
  try {
    await loadStudentsFromFirebase();
  } catch(e) {
    console.error('Dashboard load error:', e);
  } finally {
    hideLoading();
  }
};

console.log('[Firebase Updates v2] loaded ✅');
