// DEXO GTA: mashina ovozlari — dvigatel (gaz bosilganda kuchayadi) va tormoz ovozi.
// Hammasi Web Audio API bilan kod ichida yasaladi, tashqi mp3/wav fayl kerak emas.

let ctx = null;
let nodes = null;
let unlocking = false;

function makeNoiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function build(ac) {
  const master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(ac.destination);

  // ---- Dvigatel: ikkita "arra" (sawtooth) generator + pastki chastota filtri ----
  // Tezlik oshganda chastota (aylanish tezligi) va filtr ochiladi; gaz bosilganda ovoz kuchayadi va o'tkirlashadi.
  const engineFilter = ac.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 500;
  engineFilter.Q.value = 0.8;
  const engineGain = ac.createGain();
  engineGain.gain.value = 0;
  const osc1 = ac.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 45;
  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 45 * 1.5;
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.35;
  osc1.connect(engineFilter);
  osc2.connect(osc2Gain).connect(engineFilter);
  engineFilter.connect(engineGain).connect(master);
  osc1.start();
  osc2.start();

  // ---- Tormoz: filtrlangan shovqin (noise) — g'ijirlash effekti ----
  const noiseSrc = ac.createBufferSource();
  noiseSrc.buffer = makeNoiseBuffer(ac, 2);
  noiseSrc.loop = true;
  const brakeFilter = ac.createBiquadFilter();
  brakeFilter.type = 'bandpass';
  brakeFilter.frequency.value = 1800;
  brakeFilter.Q.value = 1.1;
  const brakeGain = ac.createGain();
  brakeGain.gain.value = 0;
  noiseSrc.connect(brakeFilter).connect(brakeGain).connect(master);
  noiseSrc.start();

  return { master, engineGain, engineFilter, osc1, osc2, brakeGain, brakeFilter };
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

  // Dvigatel: tezlik oshgani sayin "aylanish" balandlashadi; gaz bosilganda ovoz yanada kuchayadi va o'tkirlashadi.
  const rpm = 42 + ratio * 165 + (gas ? 28 : 0);
  nodes.osc1.frequency.setTargetAtTime(rpm, t, 0.08);
  nodes.osc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.08);
  nodes.engineFilter.frequency.setTargetAtTime(480 + ratio * 2600 + (gas ? 500 : 0), t, 0.12);
  const engineVol = (gas ? 0.5 : 0.18) + ratio * 0.28;
  nodes.engineGain.gain.setTargetAtTime(engineVol, t, 0.12);

  // Tormoz: faqat tezlik yetarli bo'lganda va tormoz bosilganda eshitiladi, tezlikka qarab kuchayadi.
  const braking = brake && speed > 1.5;
  const brakeVol = braking ? Math.min(0.5, 0.1 + ratio * 0.45) : 0;
  nodes.brakeGain.gain.setTargetAtTime(brakeVol, t, braking ? 0.04 : 0.3);
  nodes.brakeFilter.frequency.setTargetAtTime(1600 + ratio * 1400, t, 0.15);
}
