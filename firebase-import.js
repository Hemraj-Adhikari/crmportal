/* ═══════════════════════════════════════════════════════
   FIREBASE CSV IMPORT  ·  Route2Uni CRM Portal
   CSV → Firestore students collection ma import garcha
   KEY FIX: Parallel reads (Promise.all) — no sequential await inside loop
═══════════════════════════════════════════════════════ */

let csvData = [];  // PapaParse le fill garcha

/* ═══════════════════════════════════════════════════════
   FILE HANDLING
═══════════════════════════════════════════════════════ */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) parseCSVFile(file);
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('drop-zone')?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    parseCSVFile(file);
  } else {
    toast('Please drop a .csv file', 'error');
  }
}

function parseCSVFile(file) {
  Papa.parse(file, {
    header     : true,
    skipEmptyLines: true,
    complete   : (results) => {
      csvData = results.data;
      showPreview(file.name, csvData);
    },
    error: (err) => {
      toast('CSV parse error: ' + err.message, 'error');
    }
  });
}

function showPreview(filename, data) {
  if (!data.length) { toast('CSV is empty', 'error'); return; }

  document.getElementById('upload-preview').style.display = '';
  document.getElementById('preview-filename').textContent = filename;
  document.getElementById('preview-rows').textContent     = data.length + ' rows';

  const headers = Object.keys(data[0]);
  const thead   = document.getElementById('preview-thead');
  const tbody   = document.getElementById('preview-tbody');
  thead.innerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = data.slice(0, 5).map(row =>
    '<tr>' + headers.map(h => `<td>${row[h] || ''}</td>`).join('') + '</tr>'
  ).join('');
}

function clearUpload() {
  csvData = [];
  const preview = document.getElementById('upload-preview');
  if (preview) preview.style.display = 'none';
  const fileInput = document.getElementById('csv-file');
  if (fileInput) fileInput.value = '';
}

/* ═══════════════════════════════════════════════════════
   CONFIRM UPLOAD — OPTIMIZED VERSION
   Parallel reads + batched writes
═══════════════════════════════════════════════════════ */
async function confirmUpload() {
  if (!csvData.length) return;

  const total = csvData.length;
  if (!confirm(`Import ${total} students to Firestore?\n\nExisting records will be updated, new ones added.`)) return;

  if (typeof loading === 'function') loading(`Importing ${total} students…`);

  let added = 0, updated = 0, failed = 0;

  try {
    const CHUNK_SIZE = 400; // Firestore batch limit is 500

    for (let i = 0; i < csvData.length; i += CHUNK_SIZE) {
      const chunk = csvData.slice(i, i + CHUNK_SIZE);

      /* ── Step 1: Filter valid rows ── */
      const validRows = [];
      for (const row of chunk) {
        const sid = (
          row['STUDENT ID'] ||
          row['Student ID'] ||
          row['student_id'] ||
          row['StudentID'] || ''
        ).toString().trim();

        if (!sid) { failed++; continue; }
        row._sid = sid;
        validRows.push(row);
      }

      if (!validRows.length) continue;

      /* ── Step 2: Parallel existence check ── */
      const docRefs   = validRows.map(row => db.collection('students').doc(row._sid));
      const snapshots = await Promise.all(docRefs.map(ref => ref.get()));

      /* ── Step 3: Build batch (no await inside) ── */
      const batch = db.batch();

      validRows.forEach((row, idx) => {
        const exists = snapshots[idx].exists;

        // Clean row — remove empty values + internal _sid key
        const cleanRow = {};
        Object.entries(row).forEach(([k, v]) => {
          if (k === '_sid') return;
          const val = (v !== undefined && v !== null) ? v.toString().trim() : '';
          if (val !== '') cleanRow[k.trim()] = val;
        });

        if (exists) {
          batch.set(docRefs[idx], {
            ...cleanRow,
            updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy : window.staff?.name || 'CSV Import'
          }, { merge: true });
          updated++;
        } else {
          batch.set(docRefs[idx], {
            ...cleanRow,
            createdAt : firebase.firestore.FieldValue.serverTimestamp(),
            createdBy : window.staff?.name || 'CSV Import'
          });
          added++;
        }
      });

      /* ── Step 4: Commit batch ── */
      await batch.commit();

      const processed = Math.min(i + CHUNK_SIZE, total);
      if (typeof toast === 'function') toast(`Progress: ${processed}/${total} processed…`, 'info');
    }

    // ── Success ──
    const msg = ` Import done! Added: ${added} | Updated: ${updated}${failed ? ` | Skipped: ${failed}` : ''}`;
    if (typeof toast === 'function') toast(msg, 'success');
    clearUpload();
    await loadStudentsFromFirebase();

  } catch (e) {
    console.error('[Import] Error:', e);
    if (typeof toast === 'function') toast('Import failed: ' + e.message, 'error');
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
}

/* ═══════════════════════════════════════════════════════
   EXPORT CSV
   CLEANUP: the real, active exportStudentsCSV() lives in
   script-additions.js (loads after this file, so it always
   won) and additionally enforces an RBAC permission check
   this copy was missing. Removed the shadowed duplicate.
═══════════════════════════════════════════════════════ */

console.log('[firebase-import.js] loaded ');
