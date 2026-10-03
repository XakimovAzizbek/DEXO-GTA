// Online zonaga kirish: joy bor-yo'qligini tekshiradi, joy bo'lsa haqiqiy o'yin dvigatelini (game.js) ishga tushiradi.
import { requireUser, joinZone, leaveZone } from './firebase.js';

const params = new URLSearchParams(location.search);
const zoneId = params.get('zone');
const loadingText = document.getElementById('loadingText');
const zoneBadge = document.getElementById('zoneBadge');

function zoneLabel(id) { return id ? id.replace('zone', 'Zona ') : 'Zona'; }

function fail(message) {
  if (loadingText) loadingText.textContent = message;
  setTimeout(() => { location.replace('online-game.html'); }, 1800);
}

(async function init() {
  if (!zoneId) { fail('Zona tanlanmagan. Lobiga qaytilmoqda…'); return; }

  const user = await requireUser();
  if (!user) { location.replace('sign-up.html'); return; }

  if (loadingText) loadingText.textContent = `${zoneLabel(zoneId)}ga ulanmoqda…`;
  const res = await joinZone(zoneId, user);
  if (!res.joined) {
    fail(`${zoneLabel(zoneId)} to‘lib qoldi (10/10). Lobiga qaytilmoqda…`);
    return;
  }

  if (zoneBadge) {
    zoneBadge.hidden = false;
    zoneBadge.textContent = `${zoneLabel(zoneId)} — onlayn`;
  }

  const game = await import('./game.js');   // joy tasdiqlangach, asosiy o'yin dvigatelini ishga tushiramiz
  await game.startMultiplayer(zoneId, user.uid);   // zonadagi boshqa o'yinchilarni ko'rsatish/ularga o'zimizni yuborish

  const leave = () => {
    game.stopMultiplayer();
    leaveZone(zoneId, user.uid);
  };
  addEventListener('pagehide', leave);
  addEventListener('beforeunload', leave);
  const leaveBtn = document.getElementById('leaveZoneBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', leave);
})();
