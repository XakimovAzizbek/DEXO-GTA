import { signInGoogle, finishRedirectSignIn, watchAuth } from './firebase.js';

const btn = document.getElementById('googleBtn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

function goHome() {
  location.replace('index.html');
}

// Foydalanuvchi allaqachon tizimga kirgan bo'lsa, shu sahifada qolmasin.
watchAuth((user) => {
  if (user) { goHome(); return; }
  document.body.classList.remove('authing');
});

// Popup ishlamay, redirect orqali Google'ga yuborilgan bo'lsa — qaytib kelganda shu yerda tugaydi.
finishRedirectSignIn()
  .then((user) => { if (user) goHome(); })
  .catch((err) => {
    console.warn('Redirect orqali kirishda xatolik:', err);
    errorEl.textContent = 'Google orqali kirishda xatolik yuz berdi. Qayta urinib ko‘ring.';
  });

btn.addEventListener('click', async () => {
  btn.disabled = true;
  errorEl.textContent = '';
  statusEl.textContent = 'Kirilmoqda…';
  try {
    const user = await signInGoogle();
    if (user) { goHome(); return; }
    // user === null: brauzer redirect orqali Google'ga olib ketildi, sahifa o'zi almashadi.
  } catch (err) {
    console.warn('Google orqali kirish muvaffaqiyatsiz:', err);
    errorEl.textContent = `Kirib bo‘lmadi: ${err && err.message ? err.message : 'noma’lum xatolik'}`;
    statusEl.textContent = '';
    btn.disabled = false;
  }
});
