// DEXO GTA: tayyor mp3 loop ovozlar (mashina, vertolyot, samolyot, shamol, tormoz, signal) uchun umumiy yordamchi.
// carAudio.js, airportAudio.js va remoteAudio.js shu fayldan foydalanadi.
// mp3 fayllar o'yin sahifasi (game.html) bilan bir papkada turadi, masalan: mashina-1.mp3
// Har bir fayl uzilishsiz aylanadigan (loop) qilib yasalgan: ichida `len` soniyalik davr bor, boshi va oxirida
// 0.1 soniyadan qo'shimcha joy qoldirilgan (mp3 kodlagichi qo'shadigan jim joylar loopga tushmasin deb).

const LOOP_PAD = 0.1;
const SOUNDS = {
  'mashina-1': 2, 'mashina-2': 2, 'mashina-3': 2, 'mashina-4': 2, 'mashina-5': 2,   // dvigatel: past -> baland aylanish
  'mashina-tormoz': 2, 'mashina-signal': 1,
  'vertolyot-rotor': 2, 'vertolyot-motor': 2,
  'samolyot-1': 2, 'samolyot-2': 2, 'samolyot-3': 2,
  'shamol': 4,
};

const rawCache = new Map();          // nom -> Promise<ArrayBuffer|null>
const decodedCache = new WeakMap();  // AudioContext -> Map(nom -> Promise)

function fetchRaw(name) {
  if (!rawCache.has(name)) {
    const src = `${name}.mp3`;
    rawCache.set(name, fetch(src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .catch((err) => { console.warn(`Ovoz fayli yuklanmadi: ${src}`, err); return null; }));
  }
  return rawCache.get(name);
}

// Faylni yuklab, ochadi (decode). Muvaffaqiyatsiz bo'lsa null qaytaradi (o'yin ovozsiz davom etadi).
export function loadSound(ac, name) {
  let map = decodedCache.get(ac);
  if (!map) { map = new Map(); decodedCache.set(ac, map); }
  if (!map.has(name)) {
    const len = SOUNDS[name];
    map.set(name, fetchRaw(name).then((raw) => {
      if (!raw || !len) return null;
      return new Promise((ok) => {
        ac.decodeAudioData(raw.slice(0), (buffer) => ok({ buffer, loopStart: LOOP_PAD, loopEnd: LOOP_PAD + len, len }),
          () => { console.warn(`Ovoz fayli ochilmadi: ${name}.mp3`); ok(null); });
      });
    }));
  }
  return map.get(name);
}

// Bitta loop: dest ga ulanadi, tezligi (playbackRate) o'zgartirilishi mumkin. Fayl yuklangach o'zi boshlanadi.
export function makeLoop(ac, name, dest) {
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(dest);
  const loop = { gain, src: null, rate: 1, dead: false };
  loadSound(ac, name).then((snd) => {
    if (loop.dead || !snd) return;
    const src = ac.createBufferSource();
    src.buffer = snd.buffer;
    src.loop = true;
    src.loopStart = snd.loopStart;
    src.loopEnd = snd.loopEnd;
    src.playbackRate.value = loop.rate;
    src.connect(gain);
    src.start(0, snd.loopStart + Math.random() * snd.len);   // tasodifiy joydan - boshqa o'yinchilar bir xil jaranglamasin
    loop.src = src;
  });
  loop.setRate = (r, t, tc) => {
    loop.rate = r;
    if (loop.src) loop.src.playbackRate.setTargetAtTime(r, t, tc);
  };
  loop.setGain = (v, t, tc) => gain.gain.setTargetAtTime(v, t, tc);
  loop.stop = () => {
    loop.dead = true;
    try { if (loop.src) loop.src.stop(); } catch { /* allaqachon to'xtagan */ }
    try { gain.disconnect(); } catch { /* ok */ }
  };
  return loop;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Bir necha loop o'rtasida aylanish (rpm) bo'yicha silliq o'tish: ikki qo'shni qatlam aralashadi,
// har biri o'z aylanishiga qarab tezlashtiriladi/sekinlashtiriladi.
function createLayered(ac, names, anchors, dest) {
  const loops = names.map((n) => makeLoop(ac, n, dest));
  return {
    loops,
    update(rpm, t, tc = 0.05) {
      let seg = anchors.length - 2;
      for (let i = 0; i < anchors.length - 1; i++) if (rpm < anchors[i + 1]) { seg = i; break; }
      const x = clamp((rpm - anchors[seg]) / (anchors[seg + 1] - anchors[seg]), 0, 1);
      for (let i = 0; i < loops.length; i++) {
        let w = 0;
        if (i === seg) w = Math.cos(x * Math.PI / 2);
        else if (i === seg + 1) w = Math.sin(x * Math.PI / 2);
        loops[i].setGain(w, t, tc);
        loops[i].setRate(clamp(rpm / anchors[i], 0.6, 1.8), t, tc);
      }
    },
    stop() { for (const l of loops) l.stop(); },
  };
}

// ---------- Mashina dvigateli (5 qatlam: 810, 1500, 2400, 3600, 5100 ayl/daq) ----------
const CAR_RPM = [810, 1500, 2400, 3600, 5100];
export const carEngineLayers = (ac, dest) =>
  createLayered(ac, ['mashina-1', 'mashina-2', 'mashina-3', 'mashina-4', 'mashina-5'], CAR_RPM, dest);

// Tezlik (0..1) -> dvigatel aylanishi. 5 pog'onali uzatma: har pog'onada aylanish ko'tarilib, almashganda tushadi.
const GEARS = [0, 0.1, 0.22, 0.38, 0.58, 0.8, 1.0001];
export function carRpm(ratio, gas = false) {
  const r = clamp(ratio, 0, 1);
  let g = 0;
  for (let i = 0; i < GEARS.length - 1; i++) if (r >= GEARS[i]) g = i;
  const frac = (r - GEARS[g]) / (GEARS[g + 1] - GEARS[g]);
  const rpm = 1100 + frac * 3800 + (g > 0 ? 300 : 0);       // 1-pog'onada boshlanish pastroq
  return clamp(rpm + (gas ? 250 : 0), 800, 5200);
}

// ---------- Samolyot dvigateli (3 qatlam: 720, 1500, 2700 ayl/daq) ----------
const PLANE_RPM = [720, 1500, 2700];
export const planeEngineLayers = (ac, dest) =>
  createLayered(ac, ['samolyot-1', 'samolyot-2', 'samolyot-3'], PLANE_RPM, dest);
export const planeRpm = (ratio, gas, brake) =>
  clamp(760 + clamp(ratio, 0, 1) * 1750 + (gas ? 250 : 0) - (brake ? 100 : 0), 720, 2700);
