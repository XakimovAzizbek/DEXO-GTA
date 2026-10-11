// DEXO GTA: mashina ovozlari — dvigatel (tezlik va gazga qarab), yo'l shovqini, tormoz g'ijirlashi va signal.
// Ovozlar tayyor mp3 fayllardan (mashina-1..5.mp3, shamol.mp3, mashina-tormoz.mp3, mashina-signal.mp3) olinadi,
// sfx.js ularni yuklab, uzilishsiz aylantiradi. Fayllar o'yin sahifasi bilan bir papkada turishi kerak.

import { makeLoop, carEngineLayers, carRpm } from './sfx.js';

let ctx = null;
let nodes = null;
let unlocking = false;

function build(ac) {
  const master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(ac.destination);

  // ---- Dvigatel: 5 ta mp3 qatlam (past -> baland aylanish), aylanishga qarab aralashadi ----
  const engineFilter = ac.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 3000;
  const engineGain = ac.createGain();
  engineGain.gain.value = 0;
  engineFilter.connect(engineGain).connect(master);
  const engine = carEngineLayers(ac, engineFilter);

  // ---- Yo'l/shamol shovqini: tezlik oshgani sari kuchayadi ----
  const roadFilter = ac.createBiquadFilter();
  roadFilter.type = 'lowpass';
  roadFilter.frequency.value = 800;
  roadFilter.connect(master);
  const road = makeLoop(ac, 'shamol', roadFilter);

  // ---- Tormoz g'ijirlashi ----
  const brake = makeLoop(ac, 'mashina-tormoz', master);

  // ---- Signal (klakson): ikki tovushli ----
  const horn = makeLoop(ac, 'mashina-signal', master);

  return { master, engine, engineFilter, engineGain, road, roadFilter, brake, horn };
}

// Brauzerlar ovozni faqat foydalanuvchi bosgandan keyin ruxsat beradi — shu uchun bu funksiya
// birinchi teginish/tugma bosilganda chaqiriladi (game.js da).
export function unlockCarAudio() {
  if (ctx || unlocking) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
  unlocking = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    nodes = build(ctx);
  } catch { /* Web Audio yo'q — o'yin ovozsiz davom etadi */ }
}

// Boshqa ulov (samolyot/vertolyot) faol bo'lganda mashina dvigateli ovozini o'chirish/qaytarish uchun.
export function setCarAudioActive(active) {
  if (!ctx || !nodes) return;
  nodes.master.gain.setTargetAtTime(active ? 0.55 : 0, ctx.currentTime, 0.15);
}

// Har freymda chaqiriladi. speed: m/s (musbat), maxSpeed: CAR.maxSpeed, gas/brake: input holati.
export function updateCarAudio(speed, maxSpeed, gas, brake) {
  if (!ctx || !nodes) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const ratio = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));

  // Dvigatel: tezlikka qarab pog'ona bo'yicha aylanish ko'tariladi (almashganda tushadi); gaz bosilganda ochiq va baland,
  // gazsiz (sekinlashganda) xiraroq va past ovozda.
  nodes.engine.update(carRpm(ratio, gas), t, 0.06);
  nodes.engineFilter.frequency.setTargetAtTime(gas ? 12000 : 2600 + ratio * 2600, t, 0.1);
  nodes.engineGain.gain.setTargetAtTime((gas ? 1.7 : 1.05) + ratio * 0.2, t, 0.12);

  // Yo'l shovqini
  nodes.road.setGain(Math.min(1.1, ratio * ratio * 1.3), t, 0.2);
  nodes.roadFilter.frequency.setTargetAtTime(500 + ratio * 2800, t, 0.2);

  // Tormoz: faqat tezlik yetarli bo'lganda va tormoz bosilganda eshitiladi, tezlikka qarab kuchayadi.
  const braking = brake && speed > 1.5;
  nodes.brake.setGain(braking ? Math.min(1.0, 0.2 + ratio * 0.9) : 0, t, braking ? 0.04 : 0.25);
  nodes.brake.setRate(0.85 + ratio * 0.3, t, 0.15);
}

// Signal (klakson) tugmasi bosib turilganda chaqiriladi; qo'yib yuborilsa false yuboriladi.
export function updateHorn(pressed) {
  if (!ctx || !nodes) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  nodes.horn.setGain(pressed ? 1.5 : 0, t, pressed ? 0.015 : 0.09);
}
