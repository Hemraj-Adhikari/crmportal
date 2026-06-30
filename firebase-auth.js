/* ═══════════════════════════════════════════════════════
   FIREBASE AUTH  ·  Route2Uni CRM Portal  (RBAC UPDATED)
   Handles: login, logout, session boot, role-based access
   Replaces: script.js ko doLogin(), bootSession(), signOut()

   NOTE: loadStudentsFromFirebase() is NOT defined here.
   The canonical version lives in firebase-updates.js / script-additions.js.
   bootSession() calls it and awaits it so the UI stays
   gated behind a boot overlay until data is ready.

   RBAC NOTE: Roles ani access control aba 'users' collection
   bata aauxa (pahile 'staff' thiyo). Doc ID = user ko email
   (lowercase). Each doc ma: { name, role, partnerId, active }
   Roles: Super Admin | Admin | Document Officer | Application User | Channel Partner
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
   CENTRALIZED FIRESTORE LISTENER MANAGER
   Single source of truth for every onSnapshot() subscription
   in the app (students, channelPartners, notifications, chat,
   users, cas_shield, …).

   Why: previously each module kept its own
   window._xUnsubscribe variable and re-implemented the same
   "unsubscribe old one before starting a new one" guard by
   hand. That's easy to forget (duplicate listeners → duplicate
   reads / duplicate UI updates / memory leaks) and there was
   no single place to tear everything down on sign-out or
   tab/view changes.

   Usage (existing call sites are unchanged — they just route
   through this instead of managing their own unsubscribe var):

     ListenerManager.register('students', () => query.onSnapshot(...));
     ListenerManager.unregister('students');     // stop just one
     ListenerManager.has('students');             // is it active?
     ListenerManager.unsubscribeAll();             // stop everything (sign-out)

   register(key, attachFn) automatically unsubscribes any
   existing listener registered under the same key before
   calling attachFn(), so callers never need to manage their
   own unsubscribe variable — this is what prevents duplicate
   listeners regardless of how many times a screen/view is
   re-entered.
═══════════════════════════════════════════════════════ */
window.ListenerManager = (function () {
  const listeners = {}; // key -> unsubscribe function

  function register(key, attachFn) {
    // Always tear down any existing listener under this key first —
    // this is the single choke point that prevents duplicate listeners.
    unregister(key);
    try {
      const unsubscribe = attachFn();
      if (typeof unsubscribe === 'function') {
        listeners[key] = unsubscribe;
      } else {
        console.warn(`[ListenerManager] register('${key}') — attachFn did not return an unsubscribe function`);
      }
      return unsubscribe;
    } catch (e) {
      console.error(`[ListenerManager] failed to attach listener '${key}':`, e);
      return null;
    }
  }

  function unregister(key) {
    if (typeof listeners[key] === 'function') {
      try { listeners[key](); } catch (e) { console.warn(`[ListenerManager] error unsubscribing '${key}':`, e); }
    }
    delete listeners[key];
  }

  function has(key) {
    return typeof listeners[key] === 'function';
  }

  function unsubscribeAll() {
    Object.keys(listeners).forEach(unregister);
  }

  function activeKeys() {
    return Object.keys(listeners);
  }

  return { register, unregister, has, unsubscribeAll, activeKeys };
})();

/* ═══════════════════════════════════════════════════════
   RBAC — ROLE DEFINITIONS, RANK & ACCESS CHECK
   (yo section maathi raakhya kina ki auth listener ले
   tala यही functions use garcha)
═══════════════════════════════════════════════════════ */

// Hierarchy: thulo number bhayeko role le tala ka role ko access pani paucha.
// Strict matching chahiye bhane ROLE_RANK fallback line haru comment garnu.
const ROLE_RANK = {
  'Super Admin'      : 5,
  'Admin'            : 4,
  'Document Officer' : 3,
  'Application User' : 2,
  'Channel Partner'  : 1
};

const ALL_ROLES = Object.keys(ROLE_RANK);

/**
 * checkAccess(requiredRoles)
 * requiredRoles: string | string[] — kun role(s) le yo page/action access garna milxa
 * Return: true/false. Login bhayeko chaina bhane sidai false.
 */
function checkAccess(requiredRoles) {
  const role = window.staff?.role;
  if (!role) return false;

  const allowed = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

  // Exact match
  if (allowed.includes(role)) return true;

  // Hierarchy fallback — comment garnu parae strict matching matra chahiye
  const myRank = ROLE_RANK[role] ?? 0;
  return allowed.some(r => myRank >= (ROLE_RANK[r] ?? 999));
}

/**
 * guardView(viewName, requiredRoles)
 * switchView() bhitra call garne — permission nabhae toast dekhaucha ra false return garcha.
 */
function guardView(viewName, requiredRoles) {
  if (checkAccess(requiredRoles)) return true;
  if (typeof toast === 'function') {
    toast(`Tapaisanga "${viewName}" herne permission chaina`, 'error');
  }
  return false;
}

/* ═══════════════════════════════════════════════════════
   AUTH STATE LISTENER
   Page load ma automatically check garcha
═══════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    if (window.ListenerManager) window.ListenerManager.unsubscribeAll();
    return; // Login screen nai dekhaucha by default
  }

  const emailKey = (user.email || '').trim().toLowerCase();

  try {
    const doc = await db.collection('users').doc(emailKey).get();

    if (doc.exists && doc.data().active !== false) {
      const { name, role, partnerId } = doc.data();

      if (!ALL_ROLES.includes(role)) {
        console.warn('[Auth] Unknown role on user doc:', role);
        showLoginError('Your account role is not recognized. Contact admin.');
        auth.signOut();
        return;
      }

      bootSession(name || emailKey, role, emailKey, partnerId || null);
    } else {
      // Firestore ma users record chaina, ya active:false xa — sign out
      console.warn('[Auth] No active user record found for:', emailKey);
      showLoginError('Your account is not set up or has been disabled. Contact admin.');
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
   Waits for loadStudentsFromFirebase() (defined in
   firebase-updates.js / script-additions.js) before releasing
   the boot overlay, so stats/table/funnel never render
   against empty or unscoped data.
═══════════════════════════════════════════════════════ */
function bootSession(name, role, email = '', partnerId = null) {
  const ini = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // window.staff aba RBAC ko source of truth ho — role + partnerId yahi bata aauxa
  window.staff = { name, initials: ini, role, email, partnerId };

  // Sidebar + header
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sb-avatar', ini);
  set('sb-name',   name);
  set('sb-role',   role);
  set('hdr-avatar', ini.slice(0, 1));
  set('page-subtitle', 'Welcome back, ' + name.split(' ')[0] + '!');

  // Role-based UI visibility (RBAC)
  applyRoleUI(role);

  // Hide login screen
  hideLogin();

  // Block UI on a boot overlay until student data has loaded
  showBootOverlay();

  if (typeof loadStudentsFromFirebase !== 'function') {
    console.error('[bootSession] loadStudentsFromFirebase is not defined — check that firebase-updates.js / script-additions.js loaded before this runs.');
    hideBootOverlay();
    return;
  }

  loadStudentsFromFirebase().finally(hideBootOverlay);
}

/* ─── Boot overlay — shown between login and data being ready ─── */
function showBootOverlay() {
  let el = document.getElementById('boot-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:var(--surface-base,#fff);z-index:999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px';
    el.innerHTML = '<div class="spinner"></div><span style="font-size:12px;color:var(--text-muted)">Loading your data…</span>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

function hideBootOverlay() {
  document.getElementById('boot-overlay')?.remove();
}

/* ═══════════════════════════════════════════════════════
   ROLE-BASED UI  (RBAC)
   checkAccess() use garcha (maathi defined), purano hardcoded
   'role === Admin' jasto check haru hatayeko.

   HTML ma class haru thapnu (already existing classes,
   naya thapna man parae):
     .admin-only        -> Super Admin, Admin
     .staff-only        -> Super Admin, Admin, Document Officer, Application User
     .docofficer-only   -> Super Admin, Admin, Document Officer
     .partner-only      -> Channel Partner
═══════════════════════════════════════════════════════ */
function applyRoleUI(role) {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = checkAccess(['Super Admin', 'Admin']) ? '' : 'none';
  });

  document.querySelectorAll('.staff-only').forEach(el => {
    el.style.display = checkAccess(['Super Admin', 'Admin', 'Document Officer', 'Application User']) ? '' : 'none';
  });

  document.querySelectorAll('.docofficer-only').forEach(el => {
    el.style.display = checkAccess(['Super Admin', 'Admin', 'Document Officer']) ? '' : 'none';
  });

  document.querySelectorAll('.partner-only').forEach(el => {
    el.style.display = checkAccess('Channel Partner') ? '' : 'none';
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
  if (window.ListenerManager) window.ListenerManager.unsubscribeAll();
  auth.signOut().then(() => location.reload()).catch(() => location.reload());
}

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

console.log('[firebase-auth.js] loaded  (RBAC enabled — users collection)');
