import { emailAuth, watchAuth } from './firebase.js';

const form = document.getElementById('authForm');
const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const toggleBtn = document.getElementById('togglePass');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

// Kirish jarayoni ketayotganda watchAuth sahifani darrov almashtirib yubormasin —
// avval "akkaunt yaratildi / akkaunt mavjud" xabari ko'rinishi kerak.
let busy = false;

function goHome() {
  location.replace('index.html');
}

// Foydalanuvchi allaqachon tizimga kirgan bo'lsa, shu sahifada qolmasin.
watchAuth((user) => {
  if (user && !busy) { goHome(); return; }
  if (!user) document.body.classList.remove('authing');
});

// Parolni ko'rsatish / yashirish (telefonda yozganda xato qilmaslik uchun).
toggleBtn.addEventListener('click', () => {
  const show = passEl.type === 'password';
  passEl.type = show ? 'text' : 'password';
  toggleBtn.textContent = show ? 'Yashir' : 'Ko‘rsat';
  toggleBtn.setAttribute('aria-label', show ? 'Parolni yashirish' : 'Parolni ko‘rsatish');
});

function friendlyError(err) {
  switch (err && err.code) {
    case 'auth/invalid-email':
      return 'Email manzili noto‘g‘ri yozilgan.';
    case 'auth/weak-password':
      return 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Bu email bilan hisob mavjud, lekin parol noto‘g‘ri.';
    case 'auth/too-many-requests':
      return 'Juda ko‘p urinish bo‘ldi. Biroz kutib, qayta urinib ko‘ring.';
    case 'auth/network-request-failed':
      return 'Internet bilan aloqa yo‘q. Ulanishni tekshirib, qayta urinib ko‘ring.';
    case 'auth/user-disabled':
      return 'Bu hisob o‘chirib qo‘yilgan.';
    case 'auth/operation-not-allowed':
      return 'Email/parol orqali kirish Firebase’da yoqilmagan (Authentication → Sign-in method).';
    default:
      return `Kirib bo‘lmadi: ${err && err.message ? err.message : 'noma’lum xatolik'}`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  statusEl.textContent = '';
  statusEl.classList.remove('success');

  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !email.includes('@')) {
    errorEl.textContent = 'Email manzilini to‘g‘ri kiriting.';
    emailEl.focus();
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.';
    passEl.focus();
    return;
  }

  busy = true;
  submitBtn.disabled = true;
  statusEl.textContent = 'Tekshirilmoqda…';

  try {
    const { isNew } = await emailAuth(email, password);
    statusEl.classList.add('success');
    statusEl.textContent = isNew
      ? 'Siz uchun yangi akkaunt muvaffaqiyatli yaratildi!'
      : 'Sizda avval akkaunt mavjud — tizimga kirildi.';
    setTimeout(goHome, 1800);
  } catch (err) {
    console.warn('Email orqali kirish muvaffaqiyatsiz:', err);
    errorEl.textContent = friendlyError(err);
    statusEl.textContent = '';
    busy = false;
    submitBtn.disabled = false;
  }
});
