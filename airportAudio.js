// DEXO GTA: samolyot va vertolyot ovozlari — tayyor mp3 fayllardan (sfx.js orqali).
// Vertolyot: rotor "tars-tars" (vertolyot-rotor.mp3) + turbina ovozi (vertolyot-motor.mp3) + shamol (shamol.mp3).
// Samolyot: parrakli dvigatel, 3 qatlam (samolyot-1..3.mp3) + tezlikka qarab kuchayadigan shamol.

import { makeLoop, planeEngineLayers, planeRpm } from './sfx.js';

let ctx = null;
let heliNodes = null;
let planeNodes = null;
let unlocking = false;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- Vertolyot ----
function buildHeli(ac) {
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  const rotor = makeLoop(ac, 'vertolyot-rotor', master);
  const motor = makeLoop(ac, 'vertolyot-motor', master);
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 900;
  windFilter.Q.value = 0.7;
  windFilter.connect(master);
  const wind = makeLoop(ac, 'shamol', windFilter);

  return { master, rotor, motor, wind, windFilter };
}

// ---- Samolyot ----
function buildPlane(ac) {
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  const engineFilter = ac.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 4000;
  const engineGain = ac.createGain();
  engineGain.gain.value = 1.2;
  engineFilter.connect(engineGain).connect(master);
  const engine = planeEngineLayers(ac, engineFilter);

  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 900;
  windFilter.connect(master);
  const wind = makeLoop(ac, 'shamol', windFilter);

  return { master, engine, engineFilter, engineGain, wind, windFilter };
}

// Brauzerlar ovozni faqat foydalanuvchi bosgandan keyin ruxsat beradi.
export function unlockAirportAudio() {
  if (ctx || unlocking) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
  unlocking = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    heliNodes = buildHeli(ctx);
    planeNodes = buildPlane(ctx);
  } catch { /* Web Audio yo'q — o'yin ovozsiz davom etadi */ }
}

// Ikkisini ham o'chirish (mashinaga o'tilganda yoki pauzada chaqiriladi).
export function stopAirportAudio() {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (heliNodes) heliNodes.master.gain.setTargetAtTime(0, t, 0.15);
  if (planeNodes) planeNodes.master.gain.setTargetAtTime(0, t, 0.15);
}

// Har freymda chaqiriladi (faqat vertolyot faol bo'lganda). speed: m/s, climb: -1..1 (pastga/tepaga).
export function updateHeliAudio(speed, maxSpeed, gas, climb = 0) {
  if (!ctx || !heliNodes) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const ratio = clamp(speed / Math.max(1, maxSpeed), 0, 1);
  const up = Math.max(0, climb);

  heliNodes.master.gain.setTargetAtTime(0.55, t, 0.2);
  // Tezroq uchsa / ko'tarilsa rotor tezroq "tars-tars" qiladi
  heliNodes.rotor.setRate(0.92 + ratio * 0.2 + (gas ? 0.05 : 0) + up * 0.1, t, 0.15);
  heliNodes.rotor.setGain(1.6 + ratio * 0.3, t, 0.2);
  heliNodes.motor.setRate(0.9 + ratio * 0.15 + (gas ? 0.08 : 0) + up * 0.1, t, 0.15);
  heliNodes.motor.setGain(1.1 + (gas ? 0.4 : 0), t, 0.2);
  heliNodes.wind.setGain(Math.min(1.0, ratio * 1.2), t, 0.2);
  heliNodes.windFilter.frequency.setTargetAtTime(700 + ratio * 1200, t, 0.2);
}

// Har freymda chaqiriladi (faqat samolyot faol bo'lganda). speed: m/s, maxSpeed: CAR.maxSpeed.
export function updatePlaneAudio(speed, maxSpeed, gas, brake) {
  if (!ctx || !planeNodes) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const ratio = clamp(speed / Math.max(1, maxSpeed), 0, 1);

  planeNodes.master.gain.setTargetAtTime(0.55, t, 0.2);
  planeNodes.engine.update(planeRpm(ratio, gas, brake), t, 0.08);
  planeNodes.engineFilter.frequency.setTargetAtTime(2800 + ratio * 4000 + (gas ? 1500 : 0), t, 0.12);
  planeNodes.engineGain.gain.setTargetAtTime((gas ? 1.8 : 1.3) + ratio * 0.3, t, 0.12);

  // Shamol: past tezlikda deyarli sezilmaydi, yuqori tezlikda kuchli hushtak
  planeNodes.wind.setGain(Math.min(1.2, ratio * ratio * 1.5), t, 0.2);
  planeNodes.windFilter.frequency.setTargetAtTime(700 + ratio * 1500, t, 0.2);
}
