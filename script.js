/* ═══════════ FIREBASE CONFIGURATION ═══════════ */
const firebaseConfig = {
  apiKey: "AIzaSyB-xxxxxxxxxxxxxxx", // Aafno actual key halnu
  authDomain: "portal-8f42b.firebaseapp.com",
  projectId: "portal-8f42b",
  storageBucket: "portal-8f42b.appspot.com",
  messagingSenderId: "xxxxxxxxxxx",
  appId: "1:xxxxxxxxxx:web:xxxxxxxxxx"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ═══════════ CONFIG ═══════════ */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzVg_S_d8Z8XyTjuF7ri5v9K9swAczaiF_CvruvJC-14fSC1IzEikF4O2YqWR4fR3XR/exec';
const SK_ROLE = 'r2u_role', SK_USER = 'r2u_user', SK_TIME = 'r2u_time', SESSION_TTL = 12 * 60 * 60 * 1000;

/* ═══════════ STATE ═══════════ */
let staff = { name: '', initials: '', role: 'Staff', email: '' };
let students = []; // Firebase bata load huncha

/* ═══════════ INITIALIZATION ═══════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Login check
  const role = localStorage.getItem(SK_ROLE);
  const t = parseInt(localStorage.getItem(SK_TIME) || '0', 10);
  
  if (role && Date.now() - t <= SESSION_TTL) {
    bootSession(localStorage.getItem(SK_USER) || 'Staff', role);
  }

  // Load Students from Firebase
  loadStudentsFromFirebase();
});

/* ═══════════ FIREBASE DATA FETCHING ═══════════ */
async function loadStudentsFromFirebase() {
  console.log("Loading students from Firestore...");
  try {
    const snapshot = await db.collection("students").get();
    students = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    console.log("Students loaded:", students);
    if(typeof filterTableStudents === 'function') filterTableStudents();
  } catch (e) {
    console.error("Firestore loading error: ", e);
  }
}

/* ═══════════ AUTH & BOOT ═══════════ */
function bootSession(name, role) {
  const ini = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  staff = { name, initials: ini, role };
  document.getElementById('sb-avatar').textContent = ini;
  document.getElementById('sb-name').textContent = name;
  document.getElementById('sb-role').textContent = role;
  hideLogin();
}

function hideLogin() {
  const el = document.getElementById('login-screen');
  if(el) { el.classList.add('hidden'); setTimeout(() => el.style.display = 'none', 280); }
}

function signOut() {
  ['r2u_role', 'r2u_user', 'r2u_time'].forEach(k => localStorage.removeItem(k));
  location.reload();
}

/* ═══════════ UTILS ═══════════ */
function toast(msg, type = 'success') {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Keep your existing view switching and UI logic here...
