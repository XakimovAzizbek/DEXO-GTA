import { loadSelectedCarName, loadSettings } from './data.js';
import { preloadAllGLB } from './glbCache.js';
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
  startPreload();
});

account.addEventListener('click', () => account.classList.toggle('is-revealed'));

// ---------- Fayllarni oldindan yuklash (foiz bilan) ----------
// Sahifa ochilgach hamma GLB fayllar orqa fonda yuklanib, telefon xotirasiga (IndexedDB) saqlanadi.
const preloadBox = document.getElementById('preload');
const preloadLabel = document.getElementById('preloadLabel');
const preloadPct = document.getElementById('preloadPct');
const preloadFill = document.getElementById('preloadFill');
const preloadSub = document.getElementById('preloadSub');
let preloadStarted = false;

function fmtSize(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function showPreload(s) {
  if (s.state === 'nothing' || s.state === 'cached') { preloadBox.hidden = true; return; }
  preloadBox.hidden = false;
  if (s.state === 'offline') {
    preloadLabel.textContent = 'Internet yo‘q — fayllar keyinroq yuklanadi';
    preloadPct.textContent = '';
    preloadFill.style.width = '0%';
    preloadSub.textContent = '';
    return;
  }
  const pct = Math.max(0, Math.min(100, s.percent || 0));
  preloadPct.textContent = `${pct}%`;
  preloadFill.style.width = `${pct}%`;
  if (s.state === 'scanning') {
    preloadLabel.textContent = s.group || 'Fayllar tekshirilmoqda…';
    preloadSub.textContent = '';
    return;
  }
  const size = `${fmtSize(s.loaded)} / ${fmtSize(s.total)}`;
  if (s.state === 'done') {
    preloadLabel.textContent = s.failed ? `${s.failed} ta fayl yuklanmadi` : 'Hammasi yuklandi ✓';
    preloadSub.textContent = size;
    if (!s.failed) setTimeout(() => { preloadBox.hidden = true; }, 4000);
    return;
  }
  preloadLabel.textContent = `Yuklanmoqda: ${s.group || ''}`;
  preloadSub.textContent = s.lowStorage ? `${size} · Telefon xotirasi yetmasligi mumkin` : size;
}

function startPreload() {
  if (preloadStarted) return;
  preloadStarted = true;
  let includeCity = false;
  try { includeCity = !!loadSettings().useCityModel; } catch { /* sozlama o'qilmadi - shahar modelisiz davom etamiz */ }
  preloadAllGLB(showPreload, { includeCity }).catch(() => { preloadBox.hidden = true; });
}
