// DEXO GTA: samolyot va vertolyot ovozlari — mashinadan farqli, Web Audio API bilan kod ichida yasaladi.
// Vertolyot: pastki "gurr-gurr" (rotor aylanishi) + shamol shovqini.
// Samolyot: motor/vint g'ovullashi + tezlikka qarab kuchayadigan shamol shovqini.

let ctx = null;
let heliNodes = null;
let planeNodes = null;
let unlocking = false;

function makeNoiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ---- Vertolyot: pastki karrier tebranish + rotor tezligida amplituda modulyatsiyasi ("gurr-gurr") + shamol ----
function buildHeli(ac) {
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  const carrier = ac.createOscillator();
  carrier.type = 'sawtooth';
  carrier.frequency.value = 70;
  const carrierFilter = ac.createBiquadFilter();
  carrierFilter.type = 'lowpass';
  carrierFilter.frequency.value = 420;
  const carrierGain = ac.createGain();
  carrierGain.gain.value = 0.3;
  carrier.connect(carrierFilter).connect(carrierGain).connect(master);
  carrier.start();

  // Rotor "gurr-gurr" effekti: past chastotali LFO carrierGain.gain ni audio-tezlikda moduliatsiya qiladi.
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 7;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth).connect(carrierGain.gain);
  lfo.start();

  const windSrc = ac.createBufferSource();
  windSrc.buffer = makeNoiseBuffer(ac, 2);
  windSrc.loop = true;
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 900;
  windFilter.Q.value = 0.7;
  const windGain = ac.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter).connect(windGain).connect(master);
  windSrc.start();

  return { master, carrier, carrierFilter, carrierGain, lfo, lfoDepth, windFilter, windGain };
}

// ---- Samolyot: ikkita "arra" (propeller/turbina g'ovullashi) + tezlik bilan kuchayadigan shamol ----
function buildPlane(ac) {
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  const engineFilter = ac.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 900;
  engineFilter.Q.value = 0.6;
  const engineGain = ac.createGain();
  engineGain.gain.value = 0.32;
  const osc1 = ac.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 130;
  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 130 * 1.01;   // biroz detune - "vint" tebranishi
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.5;
  osc1.connect(engineFilter);
  osc2.connect(osc2Gain).connect(engineFilter);
  engineFilter.connect(engineGain).connect(master);
  osc1.start();
  osc2.start();

  const windSrc = ac.createBufferSource();
  windSrc.buffer = makeNoiseBuffer(ac, 2);
  windSrc.loop = true;
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 1400;
  const windGain = ac.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter).connect(windGain).connect(master);
  windSrc.start();

  return { master, engineFilter, engineGain, osc1, osc2, windFilter, windGain };
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
  const ratio = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));

  heliNodes.master.gain.setTargetAtTime(0.5, t, 0.2);
  const rpm = 62 + ratio * 40 + (gas ? 14 : 0) + Math.max(0, climb) * 22;
  heliNodes.carrier.frequency.setTargetAtTime(rpm, t, 0.1);
  heliNodes.lfo.frequency.setTargetAtTime(6.5 + ratio * 2.5, t, 0.15);   // tezroq uchsa rotor tezroq eshitiladi
  heliNodes.carrierFilter.frequency.setTargetAtTime(380 + ratio * 500 + (gas ? 200 : 0), t, 0.15);
  heliNodes.windGain.gain.setTargetAtTime(Math.min(0.35, ratio * 0.4), t, 0.2);
  heliNodes.windFilter.frequency.setTargetAtTime(700 + ratio * 1200, t, 0.2);
}

// Har freymda chaqiriladi (faqat samolyot faol bo'lganda). speed: m/s, maxSpeed: CAR.maxSpeed.
export function updatePlaneAudio(speed, maxSpeed, gas, brake) {
  if (!ctx || !planeNodes) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const ratio = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));

  planeNodes.master.gain.setTargetAtTime(0.5, t, 0.2);
  const rpm = 110 + ratio * 260 + (gas ? 35 : 0) - (brake ? 20 : 0);
  planeNodes.osc1.frequency.setTargetAtTime(rpm, t, 0.08);
  planeNodes.osc2.frequency.setTargetAtTime(rpm * 1.01, t, 0.08);
  planeNodes.engineFilter.frequency.setTargetAtTime(760 + ratio * 2200 + (gas ? 400 : 0), t, 0.12);
  const engineVol = (gas ? 0.42 : 0.22) + ratio * 0.24;
  planeNodes.engineGain.gain.setTargetAtTime(engineVol, t, 0.12);

  // Shamol shovqini tezlik bilan chiziqli kuchayadi - past tezlikda deyarli sezilmaydi, yuqorida kuchli hushtak.
  planeNodes.windGain.gain.setTargetAtTime(Math.min(0.45, ratio * ratio * 0.5), t, 0.2);
  planeNodes.windFilter.frequency.setTargetAtTime(1200 + ratio * 1800, t, 0.2);
}
