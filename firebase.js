// DEXO GTA: Firebase ulanishi — Google orqali kirish va Realtime Database.
// Bu fayl index.js va sign-up.js ikkalasida ham ishlatiladi.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase, ref, set, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA6uh9K5M_ntkeDdnJDXFNByI05j94sfDg',
  authDomain: 'dexo-gta.firebaseapp.com',
  databaseURL: 'https://dexo-gta-default-rtdb.firebaseio.com',
  projectId: 'dexo-gta',
  storageBucket: 'dexo-gta.firebasestorage.app',
  messagingSenderId: '21337569384',
  appId: '1:21337569384:web:6718eb931961bfa226e3dd',
  measurementId: 'G-9KN34X4S95',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// Popup ba'zi mobil brauzer/WebView'larda bloklanadi — shunday holatlarda redirect usuliga o'tamiz.
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/popup-closed-by-user',
]);

// Auth holati aniqlanganda (kirgan/kirmagan) chaqiriladi. Obuna bekor qilish funksiyasini qaytaradi.
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// Foydalanuvchi profilini Realtime Database'ga yozadi: users/{uid}
async function saveProfile(user) {
  if (!user) return;
  try {
    await set(ref(db, `users/${user.uid}`), {
      name: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      lastLogin: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Profilni saqlab bo‘lmadi (Realtime Database qoidalarini tekshiring):', err);
  }
}

// Google orqali kirish. Popup ishlamasa avtomatik redirect'ga o'tadi (natija null qaytadi —
// sahifa qayta yuklanganda finishRedirectSignIn orqali tugaydi).
export async function signInGoogle() {
  try {
    const res = await signInWithPopup(auth, provider);
    await saveProfile(res.user);
    return res.user;
  } catch (err) {
    if (err && REDIRECT_FALLBACK_CODES.has(err.code)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

// Redirect orqali kirish tugagandan keyin (sahifa qayta yuklanganda) chaqiriladi.
export async function finishRedirectSignIn() {
  const res = await getRedirectResult(auth);
  if (res && res.user) { await saveProfile(res.user); return res.user; }
  return null;
}

export function signOutUser() {
  return signOut(auth);
}
