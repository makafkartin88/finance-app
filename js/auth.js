import { AUTH_USERS } from './config.js';
import { state } from './state.js';

let firebaseApp = null;
let firebaseAuth = null;

export function initAuth(onReady) {
  // Dynamicky načteme Firebase SDK
  loadFirebaseSDK().then(() => {
    const firebaseConfig = {
apiKey: "AIzaSyBZAuuCcSsuiKA8UFLJoyKgUUcWNzHPL58",
authDomain: "finance-app-966b5.firebaseapp.com",
projectId: "finance-app-966b5",
storageBucket: "finance-app-966b5.firebasestorage.app",
messagingSenderId: "17807106462",
appId: "1:17807106462:web:6c41de1a0a2ab14207368f",
measurementId: "G-BD3K8RTMZB"
};

    if (!firebaseConfig.apiKey) {
      // Firebase ještě není nakonfigurovaný — spustíme appku bez auth
      console.warn('Firebase Auth není nakonfigurovaný. Spouštím bez přihlášení.');
      document.getElementById('authScreen').style.display = 'none';
      onReady();
      return;
    }

    firebaseApp = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();

    firebaseAuth.onAuthStateChanged(user => {
      if (user) {
        const email = user.email.toLowerCase();
        const allowed = AUTH_USERS[email];
        if (!allowed) {
          firebaseAuth.signOut();
          showAuthError('Přístup odmítnut. Tato aplikace je pouze pro Martin & Šárka.');
          return;
        }
        // Přihlášení úspěšné
        state.person = allowed.person;
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('authUser').textContent = user.displayName || email;
        document.getElementById('logoutBtn').style.display = 'block';

        // Nastavit person switcher
        document.querySelectorAll('.pb').forEach(b => {
          b.classList.toggle('active', b.textContent === allowed.person);
        });

        // Skrýt/zobrazit investice
        const invNav = document.querySelectorAll('.ni')[4]; // Investice nav item
        if (invNav) invNav.style.display = allowed.canSeeInvestments ? '' : 'none';

        applyPersonTheme();
        onReady();
      } else {
        showLoginScreen();
      }
    });
  }).catch(err => {
    console.error('Chyba načítání Firebase:', err);
    document.getElementById('authScreen').style.display = 'none';
    onReady();
  });
}

function applyPersonTheme() {
  document.body.classList.remove('theme-martin', 'theme-sarka');
  if (state.person === 'Martin') document.body.classList.add('theme-martin');
  if (state.person === 'Šárka') document.body.classList.add('theme-sarka');
}

function showLoginScreen() {
  const screen = document.getElementById('authScreen');
  screen.style.display = 'flex';
  screen.querySelector('.authcard').innerHTML = `
    <div style="font-size:40px;margin-bottom:14px">&#128176;</div>
    <h2>Finance App</h2>
    <p>Přihlášení pouze pro Martin & Šárka</p>
    <button class="btnp" style="width:100%;padding:12px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:10px" onclick="window._firebaseLogin()">
      <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
      Přihlásit se přes Google
    </button>
    <div id="authError" style="color:var(--red);font-size:13px;margin-top:16px;display:none"></div>
  `;
}

function showAuthError(msg) {
  const screen = document.getElementById('authScreen');
  screen.style.display = 'flex';
  showLoginScreen();
  setTimeout(() => {
    const err = document.getElementById('authError');
    if (err) { err.textContent = msg; err.style.display = 'block'; }
  }, 100);
}

async function loginWithGoogle() {
  if (!firebaseAuth) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebaseAuth.signInWithPopup(provider);
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showAuthError('Chyba přihlášení: ' + e.message);
    }
  }
}

export function logout() {
  if (firebaseAuth) {
    firebaseAuth.signOut();
  }
}

export function getCurrentUser() {
  return firebaseAuth?.currentUser || null;
}

export function isInvestmentsAllowed() {
  const user = getCurrentUser();
  if (!user) return true; // Pokud není auth, zobrazit vše
  const allowed = AUTH_USERS[user.email.toLowerCase()];
  return allowed?.canSeeInvestments ?? false;
}

// Expose login to window for onclick handler
window._firebaseLogin = loginWithGoogle;

function loadFirebaseSDK() {
  return new Promise((resolve, reject) => {
    if (typeof firebase !== 'undefined') { resolve(); return; }
    const s1 = document.createElement('script');
    s1.src = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}
