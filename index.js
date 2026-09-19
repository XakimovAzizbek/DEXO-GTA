import { loadSelectedCarName } from './data.js';

const status = document.getElementById('status');
const car = loadSelectedCarName();

status.textContent = car
  ? `Tanlangan mashina: ${car}`
  : 'Mashina tanlanmagan. O‘yin ro‘yxatdagi birinchi mashina bilan ochiladi.';
