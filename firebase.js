// DEXO GTA: Firebase ulanishi — email va parol orqali kirish/ro‘yxatdan o‘tish va Realtime Database.
// Bu fayl index.js va sign-up.js ikkalasida ham ishlatiladi.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, set, update, serverTimestamp, onValue, runTransaction, onDisconnect,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

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

// Auth holati aniqlanganda (kirgan/kirmagan) chaqiriladi. Obuna bekor qilish funksiyasini qaytaradi.
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// Foydalanuvchi profilini Realtime Database'ga yozadi: users/{uid}
// Yangi akkaunt bo'lsa — to'liq profil yaratiladi; avval bor akkaunt bo'lsa — faqat oxirgi kirish vaqti yangilanadi.
async function saveProfile(user, isNew) {
  if (!user) return;
  try {
    if (isNew) {
      await set(ref(db, `users/${user.uid}`), {
        name: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      });
    } else {
      await update(ref(db, `users/${user.uid}`), {
        email: user.email || '',
        lastLogin: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('Profilni saqlab bo‘lmadi (Realtime Database qoidalarini tekshiring):', err);
  }
}

// Email + parol orqali BITTA funksiyada ham ro'yxatdan o'tish, ham kirish:
//  1) avval yangi akkaunt yaratishga urinadi — muvaffaqiyatli bo'lsa { isNew: true };
//  2) bu email bilan akkaunt allaqachon bor bo'lsa — shu parol bilan kiradi, { isNew: false };
//  3) parol noto'g'ri bo'lsa — xatolik (auth/invalid-credential) tashlanadi.
// Bu usul Firebase'ning "email enumeration protection" yoqilgan bo'lsa ham ishlaydi.
export async function emailAuth(email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await saveProfile(cred.user, true);
    return { user: cred.user, isNew: true };
  } catch (err) {
    if (err && err.code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await saveProfile(cred.user, false);
      return { user: cred.user, isNew: false };
    }
    throw err;
  }
}

export function signOutUser() {
  return signOut(auth);
}

// Joriy auth holatini bir martalik va'da (promise) sifatida qaytaradi — login talab qiladigan
// sahifalarda (online-game.js, player-game.js) tekshirish uchun qulay.
export function requireUser() {
  return new Promise((resolve) => {
    const unsub = watchAuth((user) => { unsub(); resolve(user); });
  });
}

// ---------- Online zonalar: zones/{zoneId}/players/{uid} ----------
export const ZONE_COUNT = 9;
export const ZONE_CAPACITY = 10;
export const ZONE_IDS = Array.from({ length: ZONE_COUNT }, (_, i) => `zone${i + 1}`);

// Zonadagi joriy o'yinchilar sonini jonli (realtime) kuzatadi. Obuna bekor qilish funksiyasini qaytaradi.
export function watchZonePlayers(zoneId, callback) {
  const playersRef = ref(db, `zones/${zoneId}/players`);
  return onValue(playersRef, (snap) => {
    const val = snap.val() || {};
    callback(Object.keys(val).length, val);
  });
}

// Zonaga qo'shilishga urinadi: joy bo'lsa (10 tadan kam) qo'shadi, to'la bo'lsa rad etadi.
// Tranzaksiya orqali amalga oshiriladi — shu bois bir vaqtda bir nechta odam kirsa ham joylar oshib ketmaydi.
// Qaytaradi: { joined: true } yoki { joined: false, full: true }.
export async function joinZone(zoneId, user) {
  const playersRef = ref(db, `zones/${zoneId}/players`);
  const res = await runTransaction(playersRef, (current) => {
    const players = current || {};
    if (players[user.uid]) return players;            // allaqachon shu zonada (masalan sahifa yangilangan)
    if (Object.keys(players).length >= ZONE_CAPACITY) return;  // to'la — bekor qilinadi
    return { ...players, [user.uid]: { name: user.displayName || user.email || 'O‘yinchi', at: Date.now() } };
  });
  if (!res.committed) return { joined: false, full: true };
  const myRef = ref(db, `zones/${zoneId}/players/${user.uid}`);
  onDisconnect(myRef).remove();   // sahifa yopilsa/aloqa uzilsa joyi avtomatik bo'shaydi
  return { joined: true };
}

// Zonadan chiqish (sahifani tark etganda chaqiriladi; onDisconnect bo'lmagan hollar uchun ham qo'shimcha himoya).
export function leaveZone(zoneId, uid) {
  return set(ref(db, `zones/${zoneId}/players/${uid}`), null);
}
