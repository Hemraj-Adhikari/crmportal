/* ═══════════════════════════════════════════════════════
   FIREBASE AUTH  ·  Route2Uni CRM Portal
   Handles: login, logout, session boot, student loading
   Replaces: script.js ko doLogin(), bootSession(), signOut()
═══════════════════════════════════════════════════════ */

/* ─── Firebase init (ek palta matra garne) ─── */
const firebaseConfig = {
  apiKey            : "AIzaSyC-gxvykJgzcU8MCrvqZO5py2nipSYy4P0",
  authDomain        : "portal-8f42b.firebaseapp.com",
  projectId         : "portal-8f42b",
  storageBucket     : "portal-8f42b.firebasestorage.app",
  messagingSenderId : "770003878980",
  appId             : "1:770003878980:web:380022261ef4be8e6a6811"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db   = firebase.firestore();
const auth = firebase.auth();

/* ─── Firestore offline persistence (optional, improves resilience) ─── */
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

/* ═══════════════════════════════════════════════════════
   AUTH STATE LISTENER
   Page load ma automatically check garcha
═══════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  if (!user) return; // Login screen nai dekhaucha by default

  try {
    const doc = await db.collection('staff').doc(user.uid).get();
    if (doc.exists) {
      const { name, role } = doc.data();
      bootSession(name, role, user.email);
    } else {
      // Firestore ma staff record chaina — sign out
      console.warn('[Auth] No staff record found for:', user.email);
      showLoginError('Your account is not set up. Contact admin.');
      auth.signOut();
    }
  } catch (e) {
    console.error('[Auth] Role fetch error:', e);
    showLoginError('Could not verify your account. Try again.');
    auth.signOut();
  }
});

/* ═══════════════════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════════════════ */
async function doLogin() {
  const email    = (document.getElementById('login-username')?.value || '').trim();
  const password = (document.getElementById('login-password')?.value || '').trim();
  const errEl    = document.getElementById('login-error');

  errEl.style.display = 'none';

  if (!email)    { showLoginError('Enter your email.');    return; }
  if (!password) { showLoginError('Enter your password.'); return; }

  const btn     = document.getElementById('login-btn');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  btn.disabled          = true;
  btnText.textContent   = 'Signing in…';
  spinner.style.display = '';

  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged le bootSession() call garcha — yahaan kehi garnu pardaina
  } catch (e) {
    const ERRORS = {
      'auth/user-not-found'     : 'No account found with this email.',
      'auth/wrong-password'     : 'Incorrect password.',
      'auth/invalid-email'      : 'Invalid email format.',
      'auth/invalid-credential' : 'Invalid email or password.',
      'auth/too-many-requests'  : 'Too many attempts. Please wait and try again.',
      'auth/network-request-failed': 'Network error. Check your connection.',
    };
    showLoginError(ERRORS[e.code] || ('Login failed: ' + e.message));
    document.getElementById('login-password').value = '';
  } finally {
    btn.disabled          = false;
    btnText.textContent   = 'Sign in';
    spinner.style.display = 'none';
  }
}

/* Enter key press ma login */
document.addEventListener('DOMContentLoaded', () => {
  ['login-username', 'login-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  });
});

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = 'block';
}

/* ═══════════════════════════════════════════════════════
   BOOT SESSION  —  login success pachhi UI set up garcha
═══════════════════════════════════════════════════════ */
function bootSession(name, role, email = '') {
  const ini = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  window.staff = { name, initials: ini, role, email };

  // Sidebar + header
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sb-avatar', ini);
  set('sb-name',   name);
  set('sb-role',   role);
  set('hdr-avatar', ini.slice(0, 1));
  set('page-subtitle', 'Welcome back, ' + name.split(' ')[0] + '!');

  // Role-based UI visibility
  applyRoleUI(role);

  // Hide login screen
  hideLogin();

  // Load data
  loadStudentsFromFirebase();
}

/* ─── Role-based UI ─── */
function applyRoleUI(role) {
  const isAdmin = role === 'Admin';

  // Admin-only elements (Import CSV menu etc.)
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Staff-only elements
  document.querySelectorAll('.staff-only').forEach(el => {
    el.style.display = (role === 'Staff' || isAdmin) ? '' : 'none';
  });
}

/* ─── Hide login screen ─── */
function hideLogin() {
  const el = document.getElementById('login-screen');
  if (!el) return;
  el.classList.add('hidden');
  setTimeout(() => el.style.display = 'none', 280);
}

/* ═══════════════════════════════════════════════════════
   SIGN OUT
═══════════════════════════════════════════════════════ */
function signOut() {
  auth.signOut().then(() => location.reload()).catch(() => location.reload());
}

/* ═══════════════════════════════════════════════════════
   LOAD STUDENTS FROM FIRESTORE
═══════════════════════════════════════════════════════ */
async function loadStudentsFromFirebase() {
  console.log('[Firebase] Loading students from Firestore…');
  try {
    const snapshot = await db.collection('students').orderBy('createdAt', 'desc').get();
    window.students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('[Firebase] Students loaded:', window.students.length);

    // Trigger UI refreshes
    if (typeof filterTableStudents   === 'function') filterTableStudents();
    if (typeof updateStats           === 'function') updateStats();
    if (typeof updateFunnel          === 'function') updateFunnel();
    if (typeof renderDashboardPartners === 'function') renderDashboardPartners();
  } catch (e) {
    console.error('[Firebase] Student load error:', e);
    if (typeof toast === 'function') toast('Could not load students: ' + e.message, 'error');
  }
}

/* ─── loadDashboardLazy override ─── */
window.loadDashboardLazy = async function () {
  if (typeof loading === 'function') loading('Loading dashboard…');
  try {
    await loadStudentsFromFirebase();
  } catch (e) {
    console.error('[Firebase] Dashboard load error:', e);
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
};

/* ─── Password eye toggle ─── */
function togglePwd() {
  const inp  = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    icon?.setAttribute('opacity', '0.5');
  } else {
    inp.type = 'password';
    icon?.removeAttribute('opacity');
  }
}

console.log('[firebase-auth.js] loaded ✅');
