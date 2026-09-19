import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './data.js';

let settings = loadSettings();
const saved = document.getElementById('saved');
let savedTimer = 0;

function flash(text) {
  saved.textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { saved.textContent = ''; }, 1800);
}

function commit() {
  flash(saveSettings(settings) ? 'Saqlandi' : 'Saqlab bo‘lmadi: brauzer xotirasi yopiq');
}

function showOutput(key) {
  const out = document.querySelector(`[data-output="${key}"]`);
  if (!out) return;
  out.textContent = key === 'cameraDistance' ? `${settings[key]} m` : `×${Number(settings[key]).toFixed(1)}`;
}

function render() {
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    if (el.type === 'radio') el.checked = settings[key] === el.value;
    else if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
    showOutput(key);
  });
}

document.querySelectorAll('[data-setting]').forEach((el) => {
  const key = el.dataset.setting;
  const eventName = el.type === 'range' ? 'input' : 'change';
  el.addEventListener(eventName, () => {
    if (el.type === 'radio') { if (!el.checked) return; settings[key] = el.value; }
    else if (el.type === 'checkbox') settings[key] = el.checked;
    else settings[key] = Number(el.value);
    showOutput(key);
    commit();
  });
});

document.getElementById('resetSettings').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  render();
  commit();
});

render();
