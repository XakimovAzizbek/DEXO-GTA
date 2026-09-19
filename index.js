import { loadZone } from './data.js';

const status = document.getElementById('status');
const zone = loadZone();

if (zone) {
  const count = zone.objects.filter(o => o.t !== 'spawn').length;
  status.textContent = `Saqlangan zonada ${count} ta obyekt bor.`;
} else {
  status.textContent = 'Zona hali qurilmagan. O‘yin tayyor namuna zonada ochiladi.';
}
