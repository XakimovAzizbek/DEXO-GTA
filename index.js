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

watchAuth((user) => {
  if (!user) {
    location.replace('sign-up.html');
    return;
  }
  avatar.src = user.photoURL || '';
  nameEl.textContent = user.displayName || user.email || 'Foydalanuvchi';
  account.hidden = false;
  document.body.classList.remove('authing');
});

account.addEventListener('click', () => account.classList.toggle('is-revealed'));
