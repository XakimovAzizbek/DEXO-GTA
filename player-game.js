// Online zonaga kirish: joy bor-yo'qligini tekshiradi, joy bo'lsa haqiqiy o'yin dvigatelini (game.js) ishga tushiradi.
import { requireUser, joinZone, leaveZone } from './firebase.js';

const params = new URLSearchParams(location.search);
const zoneId = params.get('zone');
const loadingText = document.getElementById('loadingText');
const zoneBadge = document.getElementById('zoneBadge');

function zoneLabel(id) { return id ? id.replace('zone', 'Zona ') : 'Zona'; }

function fail(message) {
  if (loadingText) loadingText.textContent = message;
  setTimeout(() => { location.replace('online-game.html'); }, 3500);
}

// Xato kodini foydalanuvchiga tushunarli matnga aylantiradi.
function explain(err) {
  const code = (err && (err.code || err.message)) || 'noma’lum xato';
  if (code === 'PERMISSION_DENIED') return 'Ruxsat yo‘q (Database qoidalari yoki App Check). Lobiga qaytilmoqda…';
  if (code === 'timeout') return 'Server javob bermadi. Internetni tekshiring. Lobiga qaytilmoqda…';
  return `Ulanib bo‘lmadi: ${code}. Lobiga qaytilmoqda…`;
}

(async function init() {
  if (!zoneId) { fail('Zona tanlanmagan. Lobiga qaytilmoqda…'); return; }

  const user = await requireUser();
  if (!user) { location.replace('sign-up.html'); return; }

  if (loadingText) loadingText.textContent = `${zoneLabel(zoneId)}ga ulanmoqda…`;

  let res;
  try {
    res = await joinZone(zoneId, user);
  } catch (err) {
    console.error('joinZone xato:', err);
    fail(explain(err));
    return;
  }
  if (!res.joined) {
    fail(`${zoneLabel(zoneId)} to‘lib qoldi (10/10). Lobiga qaytilmoqda…`);
    return;
  }

  // Zonadan chiqish funksiyasi o'yin yuklanishidan OLDIN ulanadi — o'yin yuklanmasa ham joy bo'shaydi.
  let game = null;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    try { if (game) game.stopMultiplayer(); } catch (e) { console.warn(e); }
    leaveZone(zoneId, user.uid).catch(() => {});
  };
  addEventListener('pagehide', leave);
  addEventListener('beforeunload', leave);
  const leaveBtn = document.getElementById('leaveZoneBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', leave);

  if (zoneBadge) {
    zoneBadge.hidden = false;
    zoneBadge.textContent = `${zoneLabel(zoneId)} — onlayn`;
  }

  try {
    if (loadingText) loadingText.textContent = 'O‘yin yuklanmoqda…';
    game = await import('./game.js');   // joy tasdiqlangach, asosiy o'yin dvigatelini ishga tushiramiz
    await game.startMultiplayer(zoneId, user.uid);
  } catch (err) {
    console.error('O‘yinni yuklashda xato:', err);
    leave();
    fail(`O‘yin yuklanmadi: ${(err && (err.code || err.message)) || 'xato'}`);
  }
})();
