// DEXO GTA: umumiy ma'lumotlar (Three.js talab qilinmaydi).
// Sozlamalar, zona saqlash, obyektlar katalogi va toqnashuv hisobi shu yerda.

export const ZONE_SIZE = 240;          // zona kvadrati tomoni, metr
export const HALF = ZONE_SIZE / 2;
export const MAX_OBJECTS = 800;
export const KEYS = {
  settings: 'dexo-gta:settings',
  zone: 'dexo-gta:zone',        // faqat egasining editoridagi qoralama
  car: 'dexo-gta:car',          // tanlangan mashina nomi
  github: 'dexo-gta:github',    // faqat egasining qurilmasida (editor)
  carDraft: 'dexo-gta:cardraft:', // mashina sozlamalari qoralamasi (faqat egasi, oxiriga mashina nomi qo'shiladi)
};

export const DEFAULT_SETTINGS = {
  quality: 'medium',     // low | medium | high
  shadows: true,
  cameraDistance: 11,
  sensitivity: 1,
  showFps: false,
  useCityModel: false,
};

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function loadSettings() {
  const saved = readJSON(KEYS.settings) || {};
  return { ...DEFAULT_SETTINGS, ...saved };
}
export function saveSettings(settings) { return writeJSON(KEYS.settings, settings); }

export function loadZone() {
  const zone = readJSON(KEYS.zone);
  return isValidZone(zone) ? zone : null;
}
export function saveZone(zone) { return writeJSON(KEYS.zone, zone); }
export function clearZone() {
  try { localStorage.removeItem(KEYS.zone); } catch { /* xotira yopiq */ }
}

// ---------- Umumiy zona (hamma o'yinchilar uchun): zone.json ----------
export async function fetchSharedZone() {
  try {
    const res = await fetch('zone.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const zone = await res.json();
    return isValidZone(zone) ? zone : null;
  } catch { return null; }
}

// ---------- Mashinalar: car.txt ----------
// Format (har bir mashina "name:" qatoridan boshlanadi):
//   name: bmw
//   car: bmwM5.glb
// Qolgan qatorlar ixtiyoriy (car-editor.html yozadi), yozilmasa CAR_DEFAULTS ishlatiladi.
export const CAR_DEFAULTS = {
  length: 4.6,       // mashina uzunligi, metr (kattaligi)
  rotate: 0,         // 0 yoki 180: old va orqa tomonni almashtirish
  lift: 0,           // yerdan balandligi, metr
  carx: 0,           // mashina ekranda chapga(-) / o'ngga(+), metr
  carz: 0,           // mashina ekranda orqaga(-) / oldinga(+), metr
  camdist: 11,       // kamera masofasi, metr
  camheight: 5.72,   // kamera balandligi, metr
  aimy: 1.4,         // kamera nishon balandligi, metr
  fov: 60,           // ko'rish burchagi, daraja
  fovspeed: 0.35,    // tezlikda ko'rish burchagi kengayishi
  follow: 8,         // kamera ergashish tezligi
  tilt: 1,           // engashish kuchi (tormoz va burilishda)
};
const CAR_KEYS = Object.keys(CAR_DEFAULTS);

export function parseCarList(text) {
  const cars = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'name') { cur = { name: val, file: '', ...CAR_DEFAULTS }; cars.push(cur); }
    else if (!cur) continue;
    else if (key === 'car') cur.file = val;
    else if (CAR_KEYS.includes(key)) {
      const n = Number(val);
      cur[key] = Number.isFinite(n) && (key !== 'length' || n > 0) ? n : CAR_DEFAULTS[key];
    }
  }
  return cars.filter((c) => c.name && c.file);
}

// Ro'yxatni car.txt matniga qaytaradi (faqat standartdan farq qiladigan qiymatlar yoziladi)
export function serializeCarList(cars) {
  return cars.map((c) => {
    const lines = [`name: ${c.name}`, `car: ${c.file}`];
    for (const key of CAR_KEYS) {
      const v = Number(c[key]);
      if (Number.isFinite(v) && Math.abs(v - CAR_DEFAULTS[key]) > 1e-9) lines.push(`${key}: ${Math.round(v * 1000) / 1000}`);
    }
    return lines.join('\n');
  }).join('\n\n') + '\n';
}

export async function fetchCarList() {
  try {
    const res = await fetch('car.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    return parseCarList(await res.text());
  } catch { return []; }
}

// Kamera holati: o'yin (game.js) va car-editor.js aynan shu funksiyadan foydalanadi,
// shuning uchun editordagi ko'rinish o'yindagi bilan bir xil bo'ladi.
// distOffset: o'yinchi sozlamalaridagi kamera masofasi - 11.
export function cameraPose(p, carX, carZ, heading, speed, distOffset = 0) {
  const dist = p.camdist + distOffset;
  const height = Math.max(1.6, p.camheight + distOffset * 0.32);
  const fx = Math.sin(heading), fz = Math.cos(heading);      // oldinga
  const rx = -Math.cos(heading), rz = Math.sin(heading);     // mashinaning o'ng tomoni (ekranda ham o'ng)
  const side = -p.carx;                                       // kamera chapga = mashina ekranda o'ngga
  const ahead = 4 - p.carz;                                   // nishon nuqtasi mashina oldida
  return {
    px: carX - fx * dist + rx * side, py: height, pz: carZ - fz * dist + rz * side,
    lx: carX + fx * ahead + rx * side, ly: p.aimy, lz: carZ + fz * ahead + rz * side,
    fov: p.fov + Math.min(Math.max(speed, 0), 42) * p.fovspeed,
  };
}

// Egasining qoralamasi (faqat o'z qurilmasida; game.html?draft=1 sinash uchun)
export function loadCarDraft(name) {
  try {
    const d = JSON.parse(localStorage.getItem(KEYS.carDraft + name));
    if (!d || typeof d !== 'object') return {};
    const out = {};
    for (const key of CAR_KEYS) if (Number.isFinite(Number(d[key]))) out[key] = Number(d[key]);
    return out;
  } catch { return {}; }
}
export function saveCarDraft(name, profile) {
  try { localStorage.setItem(KEYS.carDraft + name, JSON.stringify(profile)); return true; } catch { return false; }
}

// Tanlangan mashina: faqat nomi saqlanadi, qolganini car.txt beradi
export function loadSelectedCarName() {
  try { return localStorage.getItem(KEYS.car) || ''; } catch { return ''; }
}
export function saveSelectedCarName(name) {
  try { localStorage.setItem(KEYS.car, name); return true; } catch { return false; }
}

// ---------- Katalog ----------
// hw/hd: poydevorning yarim eni/uzunligi (metr). Old tomon = modelning +z tomoni.
export const CATALOG = {
  house_small:   { label: 'Kichik uy',         group: 'Uylar',     kind: 'house', hw: 4,  hd: 4 },
  house_two:     { label: 'Ikki qavatli uy',   group: 'Uylar',     kind: 'house', hw: 5,  hd: 4.5 },
  shop:          { label: 'Do‘kon',            group: 'Uylar',     kind: 'house', hw: 6,  hd: 4.5 },
  tower:         { label: 'Baland bino',       group: 'Uylar',     kind: 'house', hw: 7,  hd: 7 },
  tree_pine:     { label: 'Archa',             group: 'Daraxtlar', kind: 'tree',  r: 0.6 },
  tree_round:    { label: 'Bargli daraxt',     group: 'Daraxtlar', kind: 'tree',  r: 0.6 },
  road_straight: { label: 'Yo‘l',              group: 'Yo‘llar',   kind: 'road',  hw: 6,  hd: 12 },
  road_cross:    { label: 'Chorraha',          group: 'Yo‘llar',   kind: 'road',  hw: 6,  hd: 6 },
  billboard:     { label: 'Reklama ekrani',    group: 'Reklama',   kind: 'billboard', hw: 1.1, hd: 0.8 },
  spawn:         { label: 'Boshlanish nuqtasi', group: 'Belgi',    kind: 'spawn' },
};
export const GROUPS = ['Uylar', 'Daraxtlar', 'Yo‘llar', 'Reklama', 'Belgi'];

// Har bir obyektga tasodifiy och rang berish uchun (asl ranglarga ko'paytiriladi).
export const TINTS = {
  house: ['#ffffff', '#ffe6cf', '#d9e8ff', '#e4ffd9', '#ffd9e2', '#f1e2ff'],
  tree:  ['#ffffff', '#e2ffd2', '#c9e6b0', '#f3ffcf'],
  road:  ['#ffffff'],
  billboard: Array.from({ length: 10 }, () => '#ffffff'),   // c = reklama tartib raqami (billboard.txt)
  spawn: ['#ffffff'],
};
export function randomTint(type, rnd = Math.random) {
  return Math.floor(rnd() * TINTS[CATALOG[type].kind].length);
}

export function hasType(t) {
  return Object.prototype.hasOwnProperty.call(CATALOG, t);
}

export function isValidZone(z) {
  return !!z && Array.isArray(z.objects) && z.objects.length <= MAX_OBJECTS &&
    z.objects.every(o => o && hasType(o.t) && Number.isFinite(+o.x) && Number.isFinite(+o.z));
}

export function normalizeObject(o) {
  const kind = CATALOG[o.t].kind;
  const tints = TINTS[kind].length;
  const s = Number(o.s);
  return {
    t: o.t,
    x: Number(o.x),
    z: Number(o.z),
    r: Number.isFinite(Number(o.r)) ? Number(o.r) : 0,
    s: Number.isFinite(s) && s > 0 ? s : 1,
    c: Math.abs(Math.floor(Number(o.c) || 0)) % tints,
  };
}

// ---------- Reklama ekranlari: billboard.txt ----------
// Format (har bir reklama "video:" qatoridan boshlanadi):
//   video: https://.../reklama.mp4      (yoki ombordagi fayl: ads/reklama.mp4)
//   button: https://...                 ("Open" tugmasi ochadigan havola)
// Faqat http/https havolalar qabul qilinadi.
export const BILLBOARD_SCREEN = { w: 12, h: 6, y: 12.5, z: 0.43 };   // ekran o'lchami (metr), balandligi va old tomondan masofasi

function safeUrl(value) {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://example.com/';
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch { return ''; }
}
export function parseBillboardList(text) {
  const ads = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const url = safeUrl(m[2].trim());
    if (key === 'video') { cur = url ? { video: url, button: '' } : null; if (cur) ads.push(cur); }
    else if (key === 'button' && cur) cur.button = url;
  }
  return ads;
}
export async function fetchBillboardList() {
  for (const file of ['billboard.txt', 'billiboard.txt']) {     // ikkinchi yozuv: fayl nomi xato qo'yilgan bo'lsa ham topiladi
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (res.ok) return parseBillboardList(await res.text());
    } catch { /* keyingi nomni sinaymiz */ }
  }
  return [];
}

// ---------- Toqnashuv ----------
// Aylanish: three.js dagi rotation.y = r bilan bir xil.
// local -> world: wx = lx*cos + lz*sin, wz = -lx*sin + lz*cos
export function makeFootprint(o) {
  const def = CATALOG[o.t];
  if (!def || def.kind === 'spawn') return null;
  if (def.kind === 'tree') {
    const r = def.r * o.s;
    return { shape: 'circle', solid: true, x: o.x, z: o.z, r, reach2: (r + 3) * (r + 3) };
  }
  const hw = def.hw * o.s, hd = def.hd * o.s;
  const reach = Math.hypot(hw, hd) + 3;
  return {
    shape: 'box', solid: def.kind === 'house' || def.kind === 'billboard', x: o.x, z: o.z, hw, hd,
    cos: Math.cos(o.r), sin: Math.sin(o.r), reach2: reach * reach,
  };
}
export function makeCollider(o) {
  const f = makeFootprint(o);
  return f && f.solid ? f : null;
}

// Doira (cx,cz,rad) va to'siq kesishsa {nx,nz,pen} qaytaradi: (nx,nz) doirani to'siqdan itarish yo'nalishi.
export function collideCircle(col, cx, cz, rad) {
  if (col.shape === 'circle') {
    const dx = cx - col.x, dz = cz - col.z;
    const d2 = dx * dx + dz * dz, min = rad + col.r;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { nx: 1, nz: 0, pen: min };
    return { nx: dx / d, nz: dz / d, pen: min - d };
  }
  const dx = cx - col.x, dz = cz - col.z;
  const lx = dx * col.cos - dz * col.sin;
  const lz = dx * col.sin + dz * col.cos;
  const px = Math.max(-col.hw, Math.min(col.hw, lx));
  const pz = Math.max(-col.hd, Math.min(col.hd, lz));
  const ddx = lx - px, ddz = lz - pz;
  const d2 = ddx * ddx + ddz * ddz;
  let nlx, nlz, pen;
  if (d2 > 1e-8) {
    if (d2 >= rad * rad) return null;
    const d = Math.sqrt(d2);
    nlx = ddx / d; nlz = ddz / d; pen = rad - d;
  } else {
    const penX = col.hw - Math.abs(lx), penZ = col.hd - Math.abs(lz);
    if (penX < penZ) { nlx = lx >= 0 ? 1 : -1; nlz = 0; pen = penX + rad; }
    else { nlx = 0; nlz = lz >= 0 ? 1 : -1; pen = penZ + rad; }
  }
  return {
    nx: nlx * col.cos + nlz * col.sin,
    nz: -nlx * col.sin + nlz * col.cos,
    pen,
  };
}

// ---------- Tayyor namuna zona ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultZone() {
  const rnd = mulberry32(7);
  const list = [];
  const add = (t, x, z, r = 0, s = 1, c = randomTint(t, rnd)) => list.push({ t, x, z, r, s, c });

  add('road_cross', 0, 0);
  for (let i = 0; i < 5; i++) {
    const d = 18 + i * 24;
    add('road_straight', 0, d);
    add('road_straight', 0, -d);
    add('road_straight', d, 0, Math.PI / 2);
    add('road_straight', -d, 0, Math.PI / 2);
  }

  const kinds = ['house_small', 'house_two', 'shop', 'house_small', 'house_two'];
  // Bosh yo'l (z o'qi) bo'ylab uylar, old tomoni yo'lga qaragan
  for (let k = 0; k < 5; k++) {
    const t = kinds[k], hd = CATALOG[t].hd;
    const z = 24 + k * 18;
    for (const sz of [1, -1]) {
      add(t, 9 + hd, sz * z, -Math.PI / 2);
      add(kinds[(k + 2) % 5], -(9 + CATALOG[kinds[(k + 2) % 5]].hd), sz * z, Math.PI / 2);
    }
  }
  // Ko'ndalang yo'l (x o'qi) bo'ylab uylar
  for (let k = 0; k < 4; k++) {
    const t = kinds[(k + 1) % 5], hd = CATALOG[t].hd;
    const x = 44 + k * 18;
    for (const sx of [1, -1]) {
      add(t, sx * x, 9 + hd, Math.PI);
      add(t, sx * (x + 9), -(9 + hd), 0);
    }
  }
  add('tower', 46, 46);
  add('tower', -46, -46);

  // Daraxtlar: yo'l va uylardan uzoqroq joylarga
  const feet = list.map(makeFootprint).filter(Boolean);
  let tries = 0, planted = 0;
  while (planted < 70 && tries < 1500) {
    tries++;
    const x = (rnd() * 2 - 1) * (HALF - 6);
    const z = (rnd() * 2 - 1) * (HALF - 6);
    if (feet.some(f => collideCircle(f, x, z, 2.4))) continue;
    const t = rnd() < 0.5 ? 'tree_pine' : 'tree_round';
    const o = { t, x, z, r: rnd() * Math.PI * 2, s: 0.8 + rnd() * 0.6, c: randomTint(t, rnd) };
    list.push(o);
    feet.push(makeFootprint(o));
    planted++;
  }

  list.push({ t: 'spawn', x: 0, z: -14, r: 0, s: 1, c: 0 });
  return { v: 1, size: ZONE_SIZE, objects: list.map(normalizeObject) };
}
