/* ═══════════════════════════════════════════════════════
   FIREBASE AUTH - LOGIN SYSTEM
   यो file ले Google Apps Script को login replace गर्छ
   script.js मा भएको doLogin(), bootSession(), signOut()
   लाई यसले override गर्छ
═══════════════════════════════════════════════════════ */

/* ═══════════ FIREBASE SETUP ═══════════ */
const firebaseConfig = {
  apiKey: "AIzaSyC-gxvykJgzcU8MCrvqZO5py2nipSYy4P0",
  authDomain: "portal-8f42b.firebaseapp.com",
  projectId: "portal-8f42b",
  storageBucket: "portal-8f42b.firebasestorage.app",
  messagingSenderId: "770003878980",
  appId: "1:770003878980:web:380022261ef4be8e6a6811"
};

firebase.initializeApp(firebaseConfig);
const db    = firebase.firestore();
const auth  = firebase.auth();

/* ═══════════ AUTH STATE LISTENER ═══════════ */
// Page load हुँदा automatically check गर्छ — already logged in छ कि छैन
auth.onAuthStateChanged(async (user) => {
  if (user) {
    // ✅ User logged in छ — Firestore बाट role/name ल्याउ
    try {
      const doc = await db.collection('staff').doc(user.email).get();
      if (doc.exists) {
        const data = doc.data();
        bootSession(data.name, data.role, user.email);
      } else {
        // Staff doc छैन — sign out गर
        console.warn('Staff record not found for:', user.email);
        auth.signOut();
      }
    } catch (e) {
      console.error('Error fetching staff role:', e);
      auth.signOut();
    }
  }
  // user छैन भने login screen देखिन्छ (default state)
});

/* ═══════════ LOGIN FUNCTION ═══════════ */
// पुरानो doLogin() लाई यसले replace गर्छ
async function doLogin() {
  // Input fields — तपाईंको HTML मा 'login-username' = email field
  const email    = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errEl    = document.getElementById('login-error');

  errEl.style.display = 'none';

  // Validation
  if (!email || !password) {
    errEl.textContent = !email ? 'Enter your email' : 'Enter your password';
    errEl.style.display = 'block';
    return;
  }

  // Loading state
  const btn     = document.getElementById('login-btn');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  btn.disabled      = true;
  btnText.textContent = 'Signing in…';
  spinner.style.display = '';

  try {
    // 🔥 Firebase Email+Password login
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged ले automatically bootSession() call गर्छ
  } catch (e) {
    // Firebase error codes
    const msg = {
      'auth/user-not-found'  : 'No account found for this email',
      'auth/wrong-password'  : 'Incorrect password',
      'auth/invalid-email'   : 'Invalid email format',
      'auth/too-many-requests': 'Too many attempts. Try again later',
      'auth/invalid-credential': 'Invalid email or password',
    }[e.code] || 'Login failed: ' + e.message;

    errEl.textContent    = msg;
    errEl.style.display  = 'block';
    document.getElementById('login-password').value = '';
  } finally {
    btn.disabled          = false;
    btnText.textContent   = 'Sign in';
    spinner.style.display = 'none';
  }
}

/* ═══════════ BOOT SESSION ═══════════ */
// Login success भएपछि UI setup गर्छ
function bootSession(name, role, email = '') {
  const ini = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  staff = { name, initials: ini, role, email };

  document.getElementById('sb-avatar').textContent   = ini;
  document.getElementById('sb-name').textContent     = name;
  document.getElementById('sb-role').textContent     = role;
  document.getElementById('hdr-avatar').textContent  = ini.slice(0, 1);
  document.getElementById('page-subtitle').textContent = 'Welcome back, ' + name.split(' ')[0] + '!';

  applyRole(role);
  hideLogin();
  loadDashboardLazy();         // students + dashboard load
  loadStudentsFromFirebase();  // Firestore बाट students ल्याउ
}

/* ═══════════ SIGN OUT ═══════════ */
// पुरानो signOut() लाई replace गर्छ
function signOut() {
  auth.signOut().then(() => {
    location.reload();
  });
}

/* ═══════════ STUDENTS — FIRESTORE LOAD ═══════════ */
async function loadStudentsFromFirebase() {
  console.log('Loading students from Firestore…');
  try {
    const snapshot = await db.collection('students').get();
    students = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    console.log('Students loaded:', students.length);

    // UI update
    if (typeof filterTableStudents === 'function') filterTableStudents();
    if (typeof updateStats         === 'function') updateStats();
    if (typeof updateFunnel        === 'function') updateFunnel();
    if (typeof renderDashboardPartners === 'function') renderDashboardPartners();
  } catch (e) {
    console.error('Firestore error:', e);
    toast('Could not load students: ' + e.message, 'error');
  }
}
