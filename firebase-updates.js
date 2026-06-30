/* ═══════════════════════════════════════════════════════
   FIREBASE WRITE OPERATIONS
   Google Apps Script को यी functions replace गर्छ:
   - saveStages()        → Pipeline update
   - submitAddStudent()  → New student add
   - submitCASUpdate()   → CAS Shield update
   - loadStudents()      → Firestore बाट load
═══════════════════════════════════════════════════════ */

/* ─── HELPER: Firestore मा student update गर्ने ─── */
async function fbUpdateStudent(studentId, patch) {
  await db.collection('students').doc(studentId).set({
    ...patch,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: staff.name || 'Staff'
  }, { merge: true });

  // Local array पनि update गर्छ
  const s = students.find(s => s['STUDENT ID'] === studentId);
  if (s) Object.assign(s, patch);
}

/* ─── 1. PIPELINE STAGES SAVE ─── */
// saveStages() लाई override गर्छ
async function saveStages() {
  if (!Object.keys(stageEdits).length) { closeDrawer('drw-stage'); return; }

  const s = students.find(s => s['STUDENT ID'] === activeStudentId);
  if (!s) return;

  const txt  = document.getElementById('stage-save-txt');
  const spin = document.getElementById('stage-save-spin');
  txt.textContent = 'Saving…'; spin.style.display = '';

  const patch = {};
  Object.values(stageEdits).forEach(e => { if (e.val) patch[e.key] = e.val; });

  // Optimistic UI update
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

/* ─── 2. ADD NEW STUDENT ─── */
// submitAddStudent() लाई override गर्छ
async function submitAddStudent() {
  const btn     = document.getElementById('as-submit-btn');
  const lbl     = document.getElementById('as-submit-lbl');
  const spin    = document.getElementById('as-submit-spin');
  const errEl   = document.getElementById('as-error');
  const successEl = document.getElementById('as-success');

  errEl.style.display = 'none';
  successEl.style.display = 'none';

  // Form values collect गर्छ
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

  // Validate
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
    // Firestore मा check — already छ कि छैन
    const existing = await db.collection('students').doc(sid).get();
    if (existing.exists) {
      errEl.textContent = `Student ID "${sid}" already exists!`;
      errEl.style.display = 'block';
      return;
    }

    // Firestore मा save गर्छ
    await db.collection('students').doc(sid).set({
      ...newStudent,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: staff.name || 'CRM'
    });

    // Local array update
    students.unshift(newStudent);
    filterTableStudents(); updateStats(); updateFunnel();

    // Success UI
    document.getElementById('as-success-detail').textContent =
      `${name} (${sid}) added to Firestore successfully.`;
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

/* ─── 3. CAS SHIELD UPDATE ─── */
// submitCASUpdate() लाई override गर्छ
async function submitCASUpdate() {
  const u = {
    'Ready for PCI'                                          : document.getElementById('cup-pci').value,
    'Visa Refusal Y/N'                                       : document.getElementById('cup-visa-r').value,
    'Information check on CAS Shield completed? Y/N'        : document.getElementById('cup-info').value,
    'Pre-CAS questionnaire on CAS shield Completed? Y/N'    : document.getElementById('cup-precas').value,
    'Study Gap Y/N'                                          : document.getElementById('cup-gap').value,
    'Same Level Studies Y/N'                                 : document.getElementById('cup-same').value,
    'PCI Invite'                                             : document.getElementById('cup-invite').value,
    'Team Comment'                                           : document.getElementById('cup-comment').value,
    updatedBy: staff.name
  };

  try {
    loading('Saving CAS…');

    // Firestore मा CAS collection मा save गर्छ
    await db.collection('cas_shield').doc(activeCASId).set({
      ...u,
      applicantId: activeCASId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Local casData update
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

/* ─── 4. LOAD STUDENTS — Firestore बाट ─── */
// loadStudents() लाई override गर्छ (Google Script बाट होइन)
async function loadStudents() {
  currentPage = 1; totalRecords = 0;
  loading('Loading students from Firestore…');
  try {
    await loadStudentsFromFirebase();
    toast('Loaded ' + students.length + ' students', 'success');
  } catch (e) {
    toast('Load failed: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}
