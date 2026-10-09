import { loadSelectedCarName } from './data.js';
import { watchAuth } from './firebase.js';

const status = document.getElementById('status');
const car = loadSelectedCarName();

status.textContent = car
  ? `Tanlangan mashina: ${car}`
  : 'Mashina tanlanmagan. O‘yin ro‘yxatdagi birinchi mashina bilan ochiladi.';

const account = document.getElementById('account');
const avatar = document.getElementById('accountAvatar');
const nameEl = document.getElementById('accountName');

// Email bilan kirganlarda rasm bo'lmaydi — ismning birinchi harfidan oddiy avatar yasaymiz.
function avatarFor(user) {
  if (user.photoURL) return user.photoURL;
  const first = (user.displayName || user.email || '').trim().charAt(0);
  const letter = /[\p{L}\p{N}]/u.test(first) ? first.toUpperCase() : '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ffc933"/><text x="32" y="43" font-size="32" font-weight="700" text-anchor="middle" font-family="sans-serif" fill="#0d1320">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

watchAuth((user) => {
  if (!user) {
    location.replace('sign-up.html');
    return;
  }
  avatar.src = avatarFor(user);
  nameEl.textContent = user.displayName || user.email || 'Foydalanuvchi';
  account.hidden = false;
  document.body.classList.remove('authing');
});

account.addEventListener('click', () => account.classList.toggle('is-revealed'));
