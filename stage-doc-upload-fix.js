// ==============================================================================
// STAGE DOCUMENT UPLOAD (Firebase Storage)
// Wired up to the "+ Add document" control and ✕ remove button that
// renderStagePipeline() already renders inside each pipeline stage
// (Update Pipeline drawer). Without these two functions, clicking either
// control does nothing — which is why uploads never showed up, could
// never be downloaded, and the next stage never unlocked.
//
// PASTE THIS BLOCK into script-additions.js, right BEFORE this line:
//   window.openStageDrawer = function(sid) {
// ==============================================================================

/**
 * Upload a single file to Firebase Storage for a given student + stage,
 * then append {name, url, path, uploadedAt} to that stage's docKey array
 * field in Firestore. stageHasDocs()/done() reads that array, so as soon
 * as it has 1+ entries this stage counts as done and the NEXT stage's
 * prevDone() becomes true — i.e. it unlocks automatically on re-render.
 */
async function uploadStageDoc(inputEl, studentId, docKey, stageIdx) {
  const file = inputEl.files[0];
  if (!file) return;

  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User'])) {
    toast('You do not have permission to upload documents', 'error');
    inputEl.value = '';
    return;
  }

  const lbl = document.getElementById(`stage-doc-upload-lbl-${stageIdx}`);
  const spin = document.getElementById(`stage-doc-upload-spin-${stageIdx}`);
  if (lbl) lbl.style.display = 'none';
  if (spin) spin.style.display = 'inline-block';

  try {
    if (!window.firebase || !firebase.storage) {
      throw new Error('Firebase Storage SDK not loaded — check the <script> include in index.html');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `student-docs/${studentId}/${docKey}/${Date.now()}_${safeName}`;
    const storageRef = firebase.storage().ref(path);

    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();

    const newDoc = {
      name: file.name,
      url,
      path,
      uploadedAt: new Date().toISOString(),
      uploadedBy: (window.staff && window.staff.name) || 'Staff'
    };

    await db.collection('students').doc(studentId).update({
      [docKey]: firebase.firestore.FieldValue.arrayUnion(newDoc)
    });

    // Update in-memory student immediately so the drawer re-renders with
    // the new doc (and next stage unlocked) without waiting on the next
    // Firestore snapshot round-trip.
    const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === studentId);
    if (s) {
      s[docKey] = Array.isArray(s[docKey]) ? [...s[docKey], newDoc] : [newDoc];
      renderStagePipeline(s);
    }

    if (typeof logActivity === 'function') logActivity('Upload', 'Document', studentId);
    toast('Document uploaded', 'success');
  } catch (e) {
    console.error('[uploadStageDoc]', e);
    toast(e.message || 'Upload failed', 'error');
  } finally {
    if (lbl) lbl.style.display = '';
    if (spin) spin.style.display = 'none';
    inputEl.value = '';
  }
}

/**
 * Removes a previously uploaded document — deletes the Firestore array
 * entry (which may re-lock the stage/next stage if it was the only doc)
 * and best-effort deletes the underlying Storage object.
 */
async function removeStageDoc(studentId, docKey, docIndex) {
  const s = (window.students || []).find(st => (st['STUDENT ID'] || st.id) === studentId);
  if (!s || !Array.isArray(s[docKey]) || !s[docKey][docIndex]) return;

  if (!checkAccess(['Super Admin', 'Admin', 'Document Officer'])) {
    toast('You do not have permission to remove documents', 'error');
    return;
  }

  if (!confirm('Remove this document?')) return;

  const docToRemove = s[docKey][docIndex];

  try {
    await db.collection('students').doc(studentId).update({
      [docKey]: firebase.firestore.FieldValue.arrayRemove(docToRemove)
    });

    if (docToRemove.path && firebase.storage) {
      firebase.storage().ref(docToRemove.path).delete()
        .catch(err => console.warn('[removeStageDoc] storage cleanup failed:', err));
    }

    s[docKey] = s[docKey].filter((_, i) => i !== docIndex);
    renderStagePipeline(s);

    if (typeof logActivity === 'function') logActivity('Delete', 'Document', studentId);
    toast('Document removed', 'success');
  } catch (e) {
    console.error('[removeStageDoc]', e);
    toast('Could not remove document', 'error');
  }
}

window.uploadStageDoc = uploadStageDoc;
window.removeStageDoc = removeStageDoc;
