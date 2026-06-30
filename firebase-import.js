/* ═══════════════════════════════════════════════════════
   FIREBASE CSV IMPORT
   script.js को confirmUpload() लाई यसले replace गर्छ
   CSV → Firestore students collection मा import हुन्छ
═══════════════════════════════════════════════════════ */

async function confirmUpload() {
  if (!csvData.length) return;

  // Confirm गर्छ
  const total = csvData.length;
  if (!confirm(`${total} students Firestore मा import गर्ने?\n\nExisting records update हुन्छन्, नयाँ add हुन्छन्।`)) return;

  loading(`Importing ${total} students to Firestore…`);

  let added = 0, updated = 0, failed = 0;

  try {
    // Batch write — Firestore मा एकैचोटि 500 सम्म लेख्न सकिन्छ
    // ठूलो CSV को लागि chunks मा गर्छौं
    const CHUNK = 400;

    for (let i = 0; i < csvData.length; i += CHUNK) {
      const chunk = csvData.slice(i, i + CHUNK);
      const batch = db.batch();

      for (const row of chunk) {
        // Student ID नभए skip गर्छ
        const sid = (row['STUDENT ID'] || row['Student ID'] || row['student_id'] || '').trim();
        if (!sid) { failed++; continue; }

        const docRef = db.collection('students').doc(sid);

        // Firestore मा check गर्छ — already छ कि छैन
        const existing = await docRef.get();

        // Data clean गर्छ — empty values हटाउँछ
        const cleanRow = {};
        Object.entries(row).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') {
            cleanRow[k.trim()] = v.toString().trim();
          }
        });

        if (existing.exists) {
          // Update गर्छ — merge: true राख्छ ताकि अरू fields delete नहोस्
          batch.set(docRef, {
            ...cleanRow,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: staff.name || 'CSV Import'
          }, { merge: true });
          updated++;
        } else {
          // नयाँ document add गर्छ
          batch.set(docRef, {
            ...cleanRow,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: staff.name || 'CSV Import'
          });
          added++;
        }
      }

      // Batch commit गर्छ
      await batch.commit();
      toast(`Progress: ${Math.min(i + CHUNK, total)}/${total} processed…`, 'info');
    }

    // Success!
    toast(`✅ Import done! Added: ${added} | Updated: ${updated}${failed ? ` | Skipped: ${failed}` : ''}`, 'success');

    // UI clear गर्छ र students reload गर्छ
    clearUpload();
    await loadStudentsFromFirebase();

  } catch (e) {
    console.error('Import error:', e);
    toast('Import failed: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}
