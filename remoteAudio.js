// DEXO GTA: onlayn o'yinda BOSHQA o'yinchilarning ovozi (dvigatel va signal).
// Uzoqlashgani sari ovoz pasayadi va xiralashadi (yumshoq filtr), signal ham shunday - lekin signal
// dvigateldan uzoqroqdan eshitiladi. Samolyot eng baland, undan keyin vertolyot, eng past - mashina
// (katta transportlar balandroq eshitiladi). Hammasi Web Audio API bilan kod ichida yasaladi.

let ctx = null;
let listening = false;
let noiseBuf = null;

// Har bir ulov turi uchun: ovoz balandligi (vol), eshitilish masofasi (ref..max, metr), signal masofasi.
const KIND = {
  car:   { ref: 6,  max: 120, vol: 0.50, hornRef: 10, hornMax: 170, hornVol: 0.55, maxSpeed: 42 },
  heli:  { ref: 20, max: 300, vol: 0.85, maxSpeed: 24 },
  plane: { ref: 30, max: 430, vol: 1.00, maxSpeed: 55 },   // samolyot - eng baland
};
export const REMOTE_HEAR_RANGE = { car: KIND.car.hornMax, heli: KIND.heli.max, plane: KIND.plane.max };

// Masofa -> 0..1 (yaqinda 1, max da 0). Kvadratik tushadi - tabiiyroq eshitiladi.
function atten(d, ref, max) {
  if (d <= ref) return 1;
  if (d >= max) return 0;
  const t = (d - ref) / (max - ref);
  return (1 - t) * (1 - t);
}

function getNoise(ac) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 2), ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// Brauzer ovozni faqat foydalanuvchi teginganidan keyin ruxsat beradi - birinchi teginishda o'zi yoqiladi.
export function initRemoteAudio() {
  if (listening) return;
  listening = true;
  const unlock = () => {
    if (!ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      } catch { /* Web Audio yo'q - o'yin ovozsiz davom etadi */ }
    }
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
    }
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
}

export function remoteAudioReady() { return !!ctx; }

function startAll(list) { for (const s of list) s.start(); }
function stopAll(list) { for (const s of list) { try { s.stop(); } catch { /* allaqachon to'xtagan */ } } }

// ---- Mashina: ikkita "arra" + filtr (dvigatel) va ikki tovushli signal ----
function buildCar(ac, out) {
  const cfg = KIND.car;
  const engineMaster = ac.createGain();
  engineMaster.gain.value = 0;
  engineMaster.connect(out);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.8;
  const engineGain = ac.createGain();
  engineGain.gain.value = 0.2;
  const osc1 = ac.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 45;
  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 67;
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.35;
  osc1.connect(filter);
  osc2.connect(osc2Gain).connect(filter);
  filter.connect(engineGain).connect(engineMaster);

  const hornMaster = ac.createGain();
  hornMaster.gain.value = 0;
  hornMaster.connect(out);
  const hornGain = ac.createGain();
  hornGain.gain.value = 0;
  const hornFilter = ac.createBiquadFilter();
  hornFilter.type = 'lowpass';
  hornFilter.frequency.value = 2200;
  const h1 = ac.createOscillator();
  h1.type = 'square';
  h1.frequency.value = 415;
  const h2 = ac.createOscillator();
  h2.type = 'square';
  h2.frequency.value = 523;
  const h2Gain = ac.createGain();
  h2Gain.gain.value = 0.55;
  h1.connect(hornFilter);
  h2.connect(h2Gain).connect(hornFilter);
  hornFilter.connect(hornGain).connect(hornMaster);

  const sources = [osc1, osc2, h1, h2];
  startAll(sources);
  return {
    sources,
    update(t, p) {
      const near = atten(p.dist, cfg.ref, cfg.max);
      const rpm = 42 + p.ratio * 165;
      osc1.frequency.setTargetAtTime(rpm, t, 0.1);
      osc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.1);
      // Uzoqda dvigatel xiraroq (past chastotali) eshitiladi
      filter.frequency.setTargetAtTime((480 + p.ratio * 2600) * (0.35 + 0.65 * Math.sqrt(near)), t, 0.15);
      engineGain.gain.setTargetAtTime(0.2 + p.ratio * 0.28, t, 0.15);
      engineMaster.gain.setTargetAtTime(near * cfg.vol, t, 0.15);
      // Signal: dvigateldan uzoqroqdan eshitiladi, lekin u ham masofa bilan pasayadi
      const hornNear = atten(p.dist, cfg.hornRef, cfg.hornMax);
      hornMaster.gain.setTargetAtTime(hornNear * cfg.hornVol, t, 0.1);
      hornFilter.frequency.setTargetAtTime(900 + 1300 * Math.sqrt(hornNear), t, 0.1);
      hornGain.gain.setTargetAtTime(p.horn ? 0.4 : 0, t, p.horn ? 0.015 : 0.09);
    },
  };
}

// ---- Vertolyot: rotorning "gurr-gurr"i + shamol ----
function buildHeli(ac, out) {
  const cfg = KIND.heli;
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(out);
  const carrier = ac.createOscillator();
  carrier.type = 'sawtooth';
  carrier.frequency.value = 70;
  const carrierFilter = ac.createBiquadFilter();
  carrierFilter.type = 'lowpass';
  carrierFilter.frequency.value = 420;
  const carrierGain = ac.createGain();
  carrierGain.gain.value = 0.3;
  carrier.connect(carrierFilter).connect(carrierGain).connect(master);
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 7;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth).connect(carrierGain.gain);
  const wind = ac.createBufferSource();
  wind.buffer = getNoise(ac);
  wind.loop = true;
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 900;
  windFilter.Q.value = 0.7;
  const windGain = ac.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(master);

  const sources = [carrier, lfo, wind];
  startAll(sources);
  return {
    sources,
    update(t, p) {
      const near = atten(p.dist, cfg.ref, cfg.max);
      carrier.frequency.setTargetAtTime(62 + p.ratio * 40, t, 0.12);
      lfo.frequency.setTargetAtTime(6.5 + p.ratio * 2.5, t, 0.15);
      carrierFilter.frequency.setTargetAtTime((380 + p.ratio * 500) * (0.4 + 0.6 * Math.sqrt(near)), t, 0.15);
      windGain.gain.setTargetAtTime(Math.min(0.35, p.ratio * 0.4), t, 0.2);
      master.gain.setTargetAtTime(near * cfg.vol, t, 0.15);
    },
  };
}

// ---- Samolyot: motor/vint g'ovullashi + tezlikda kuchayadigan shamol (eng baland) ----
function buildPlane(ac, out) {
  const cfg = KIND.plane;
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(out);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.6;
  const engineGain = ac.createGain();
  engineGain.gain.value = 0.32;
  const osc1 = ac.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 130;
  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 131.3;
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.5;
  osc1.connect(filter);
  osc2.connect(osc2Gain).connect(filter);
  filter.connect(engineGain).connect(master);
  const wind = ac.createBufferSource();
  wind.buffer = getNoise(ac);
  wind.loop = true;
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 1400;
  const windGain = ac.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(master);

  const sources = [osc1, osc2, wind];
  startAll(sources);
  return {
    sources,
    update(t, p) {
      const near = atten(p.dist, cfg.ref, cfg.max);
      const rpm = 110 + p.ratio * 260;
      osc1.frequency.setTargetAtTime(rpm, t, 0.1);
      osc2.frequency.setTargetAtTime(rpm * 1.01, t, 0.1);
      filter.frequency.setTargetAtTime((760 + p.ratio * 2200) * (0.4 + 0.6 * Math.sqrt(near)), t, 0.15);
      engineGain.gain.setTargetAtTime(0.28 + p.ratio * 0.24, t, 0.15);
      windGain.gain.setTargetAtTime(Math.min(0.45, p.ratio * p.ratio * 0.5), t, 0.2);
      master.gain.setTargetAtTime(near * cfg.vol, t, 0.15);
    },
  };
}

const BUILDERS = { car: buildCar, heli: buildHeli, plane: buildPlane };

// Bitta o'yinchi uchun ovoz yaratadi (faqat u eshitilish masofasiga kirganda chaqiriladi).
// Qaytaradi: { update({dist, pan, speed, horn}), dispose() } yoki null (audio hali yoqilmagan bo'lsa).
export function createRemoteVoice(kind) {
  if (!ctx || !BUILDERS[kind]) return null;
  const out = ctx.createGain();
  let panner = null;
  if (ctx.createStereoPanner) {
    panner = ctx.createStereoPanner();
    out.connect(panner);
    panner.connect(ctx.destination);
  } else {
    out.connect(ctx.destination);
  }
  const voice = BUILDERS[kind](ctx, out);
  const maxSpeed = KIND[kind].maxSpeed;
  return {
    update({ dist, pan = 0, speed = 0, horn = false }) {
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      if (panner) panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
      voice.update(t, { dist, ratio: Math.max(0, Math.min(1, speed / maxSpeed)), horn });
    },
    dispose() {
      stopAll(voice.sources);
      try { out.disconnect(); } catch { /* ok */ }
      if (panner) { try { panner.disconnect(); } catch { /* ok */ } }
    },
  };
}

// ---- To'qnashuv (avariya) ovozi: qarsillagan zarba + metall jaranglashi ----
// strength: 1..10 (urilish kuchi), dist: eshituvchigacha masofa (m) - uzoqda urilsa pastroq eshitiladi, pan: -1..1.
// Mening o'z mashinam urilganda dist = 0 beriladi.
export function playCrashSound(strength = 5, dist = 0, pan = 0) {
  if (!ctx) return;
  const near = atten(dist, 12, 280);
  const vol = Math.min(1, 0.28 + strength * 0.07) * near;
  if (vol < 0.02) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = vol;
  let tail = out;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p);
    tail = p;
  }
  tail.connect(ctx.destination);

  // 1) Shovqin portlashi - "krrash"
  const noise = ctx.createBufferSource();
  noise.buffer = getNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700 + strength * 120;
  bp.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.9, t0 + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28 + strength * 0.03);
  noise.connect(bp).connect(ng).connect(out);
  noise.start(t0);
  noise.stop(t0 + 0.7);

  // 2) Past "dum" - zarba
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(140, t0);
  thump.frequency.exponentialRampToValueAtTime(42, t0 + 0.22);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t0);
  tg.gain.exponentialRampToValueAtTime(0.8, t0 + 0.01);
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  thump.connect(tg).connect(out);
  thump.start(t0);
  thump.stop(t0 + 0.35);

  // 3) Metall jaranglashi (faqat kuchli urilishda baland)
  const ring = ctx.createOscillator();
  ring.type = 'square';
  ring.frequency.value = 310 + strength * 14;
  const rf = ctx.createBiquadFilter();
  rf.type = 'lowpass';
  rf.frequency.value = 1800;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t0);
  rg.gain.exponentialRampToValueAtTime(0.12 + strength * 0.015, t0 + 0.008);
  rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  ring.connect(rf).connect(rg).connect(out);
  ring.start(t0);
  ring.stop(t0 + 0.3);

  setTimeout(() => { try { out.disconnect(); } catch { /* ok */ } }, 1000);
}

// ---- Raketa portlashi: chuqur gumburlash + shovqin + chirsillash (uzoqdan ham eshitiladi) ----
// dist: eshituvchigacha masofa (m), pan: -1..1. Mening o'z portlashim uchun dist = 0.
export function playExplosionSound(dist = 0, pan = 0) {
  if (!ctx) return;
  const near = atten(dist, 30, 800);
  const vol = 1.0 * near;
  if (vol < 0.02) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = Math.min(1, vol);
  let tail = out;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p);
    tail = p;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.connect(ctx.destination);
  tail.connect(comp);

  // 1) Past shovqin - "bum" (pasayib boruvchi past chastota)
  const noise = ctx.createBufferSource();
  noise.buffer = getNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, t0);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.8);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(1.0, t0 + 0.012);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);
  noise.connect(lp).connect(ng).connect(out);
  noise.start(t0);
  noise.stop(t0 + 2.1);

  // 2) Chuqur zarba
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(110, t0);
  thump.frequency.exponentialRampToValueAtTime(26, t0 + 0.9);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t0);
  tg.gain.exponentialRampToValueAtTime(1.0, t0 + 0.015);
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
  thump.connect(tg).connect(out);
  thump.start(t0);
  thump.stop(t0 + 1.2);

  // 3) Yorilish chirsillashi (o'rta-yuqori chastota)
  const crack = ctx.createBufferSource();
  crack.buffer = getNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 0.6;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.0001, t0);
  cg.gain.exponentialRampToValueAtTime(0.7, t0 + 0.004);
  cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  crack.connect(bp).connect(cg).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.4);

  setTimeout(() => { try { out.disconnect(); comp.disconnect(); } catch { /* ok */ } }, 2600);
}

// ---- Raketa uchirilishi: "shshshsh" - tez ko'tariluvchi shovqin ----
export function playRocketLaunchSound(dist = 0, pan = 0) {
  if (!ctx) return;
  const near = atten(dist, 20, 420);
  const vol = 0.55 * near;
  if (vol < 0.02) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = vol;
  let tail = out;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p);
    tail = p;
  }
  tail.connect(ctx.destination);
  const noise = ctx.createBufferSource();
  noise.buffer = getNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(350, t0);
  bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(1.0, t0 + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
  noise.connect(bp).connect(g).connect(out);
  noise.start(t0);
  noise.stop(t0 + 1.4);
  setTimeout(() => { try { out.disconnect(); } catch { /* ok */ } }, 1800);
}
