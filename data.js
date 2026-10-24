// DEXO GTA: umumiy ma'lumotlar (Three.js talab qilinmaydi).
// Sozlamalar, zona saqlash, obyektlar katalogi va toqnashuv hisobi shu yerda.

export const ZONE_SIZE = 240;          // zona kvadrati tomoni, metr
export const HALF = ZONE_SIZE / 2;
export const MAX_OBJECTS = Infinity;   // cheklov olib tashlandi (oldin 800)

// Zona chegarasi: markazdan har bir tomonga masofa (metr). w = g'arb (-x), e = sharq (+x), n = shimol (-z), s = janub (+z).
export const MIN_EXTENT = 1;      // cheklov yo'q: xohlagancha kichik (faqat 0 dan katta bo'lsin)
export const MAX_EXTENT = Infinity; // cheklov olib tashlandi (oldin 600 m)
export const BOUNDS_STEP = 40;
export function normalizeBounds(b) {
  const src = b || {};
  const one = (v) => {
    const n = Number(v);
    return Math.min(MAX_EXTENT, Math.max(MIN_EXTENT, Number.isFinite(n) ? n : ZONE_SIZE / 2));
  };
  return { w: one(src.w), e: one(src.e), n: one(src.n), s: one(src.s) };
}
export const KEYS = {
  settings: 'dexo-gta:settings',
  zone: 'dexo-gta:zone',        // faqat egasining editoridagi qoralama
  car: 'dexo-gta:car',          // tanlangan mashina nomi
  airport: 'dexo-gta:airport',  // tanlangan samolyot/vertolyot nomi
  github: 'dexo-gta:github',    // faqat egasining qurilmasida (editor)
  carDraft: 'dexo-gta:cardraft:', // mashina sozlamalari qoralamasi (faqat egasi, oxiriga mashina nomi qo'shiladi)
  airportDraft: 'dexo-gta:airportdraft:', // samolyot/vertolyot sozlamalari qoralamasi (oxiriga nomi qo'shiladi)
};

export const DEFAULT_SETTINGS = {
  quality: 'medium',     // low | medium | high
  landscape: 'auto',     // auto | off: telefon tik turganda o'yin ichini 90° buradi
  landscapeSide: 'cw',   // cw | ccw: qaysi tomonga burilishi (o'yinda "Tomonni almashtirish" bilan o'zgaradi)
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
export const CAR_DEFAULTS = {
  length: 4.6,
  rotate: 0,
  lift: 0,
  carx: 0,
  carz: 0,
  camdist: 11,
  camheight: 5.72,
  aimy: 1.4,
  fov: 60,
  fovspeed: 0.35,
  follow: 8,
  tilt: 1,
  // --- Raketa (car-editor.html dagi "Raketa" bo'limi) ---
  rocket: 0,         // 1 = mashinaga raketa o'rnatilgan (o'yinda raketa tugmasi chiqadi)
  rocketx: 0,        // raketaning o'ng tomondagi joyi (metr); chap tomonga o'zi aks etadi
  rockety: 0,        // balandligi (metr)
  rocketz: 0,        // oldi-orqasi (metr, + burun tomon)
  rocketsize: 2.4,   // raketa uzunligi (metr)
  rockettilt: 0,     // burchak (daraja): 0 = to'g'ri oldinga, 45 = yonmacha yuqoriga, 90 = tik yuqoriga, -90 = tik pastga
  rocketpower: 1,    // raketa kuchi: uchish tezligi, yer titrashi va itarish kuchi ko'paytirgichi (0.5 .. 3)
  rocketblast: 16,   // portlash radiusi (metr): shu masofagacha portlash ta'sir qiladi
  rocketrange: 0,    // uchish masofasi (metr): shu masofada havoda portlaydi; 0 = hech narsaga tegmaguncha
};
const CAR_KEYS = Object.keys(CAR_DEFAULTS);

export const LIGHT_SHAPES = {
  round: 'Dumaloq', long: 'Uzunchoq', strip: 'Ingichka chiziq', square: 'Kvadrat',
  ring: 'Halqa', star: 'Yulduz', triangle: 'Uchburchak',
};
export const LIGHT_FUNCS = {
  brake: 'Tormoz bosilganda',
  reverse: 'Orqaga yurganda',
  button: 'Tugma bosilganda',
};
export const LIGHT_FUNC_DEFAULTS = {
  brake:   { color: '#ff2a2a', z: -2.2 },
  reverse: { color: '#ffffff', z: -2.2 },
  button:  { color: '#fff2c0', z: 2.2 },
};
export const MAX_LIGHTS = 12;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export function normalizeLight(o) {
  const src = o || {};
  const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  const shape = hasOwn(LIGHT_SHAPES, src.shape) ? src.shape : 'round';
  const func = hasOwn(LIGHT_FUNCS, src.func) ? src.func : 'brake';
  const color = /^#[0-9a-f]{6}$/i.test(String(src.color)) ? String(src.color).toLowerCase() : LIGHT_FUNC_DEFAULTS[func].color;
  return {
    shape, func, color,
    x: num(src.x, 0.7, -1.6, 1.6),
    y: num(src.y, 0.85, 0, 2.5),
    z: num(src.z, LIGHT_FUNC_DEFAULTS[func].z, -4, 4),
    size: num(src.size, 1, 0.3, 3),
    mirror: src.mirror === undefined ? 1 : (Number(src.mirror) ? 1 : 0),
  };
}
export function parseLightLine(text) {
  const obj = {};
  for (const token of String(text).trim().split(/\s+/)) {
    const i = token.indexOf('=');
    if (i > 0) obj[token.slice(0, i).toLowerCase()] = token.slice(i + 1);
  }
  return normalizeLight(obj);
}
export function serializeLight(l) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return `light: shape=${l.shape} func=${l.func} color=${l.color} x=${r(l.x)} y=${r(l.y)} z=${r(l.z)} size=${r(l.size)} mirror=${l.mirror ? 1 : 0}`;
}

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
    if (key === 'name') { cur = { name: val, file: '', ...CAR_DEFAULTS, lights: [] }; cars.push(cur); }
    else if (!cur) continue;
    else if (key === 'car') cur.file = val;
    else if (key === 'light') { if (cur.lights.length < MAX_LIGHTS) cur.lights.push(parseLightLine(val)); }
    else if (CAR_KEYS.includes(key)) {
      const n = Number(val);
      cur[key] = Number.isFinite(n) && (key !== 'length' || n > 0) ? n : CAR_DEFAULTS[key];
    }
  }
  return cars.filter((c) => c.name && c.file);
}

export function serializeCarList(cars) {
  return cars.map((c) => {
    const lines = [`name: ${c.name}`, `car: ${c.file}`];
    for (const key of CAR_KEYS) {
      const v = Number(c[key]);
      if (Number.isFinite(v) && Math.abs(v - CAR_DEFAULTS[key]) > 1e-9) lines.push(`${key}: ${Math.round(v * 1000) / 1000}`);
    }
    for (const l of (c.lights || []).slice(0, MAX_LIGHTS)) lines.push(serializeLight(normalizeLight(l)));
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

// ---------- Samolyot/vertolyot: airport.txt ----------
// Format car.txt bilan bir xil: "car:" o'rniga "airplane:" yoki "helicopter:" ishlatiladi - shu kalit
// turini ham (kind), ham GLB fayl nomini (file) belgilaydi. Kamera/o'lcham maydonlari CAR_DEFAULTS bilan
// bir xil (carx, carz, camdist, camheight, aimy, fov, fovspeed, follow, tilt, length, rotate, lift) -
// shuning uchun cameraPose() va fitCarModel() o'zgarishsiz ishlaydi.
export const AIRPORT_KINDS = { airplane: 'Samolyot', helicopter: 'Vertolyot' };
export const AIRPORT_DEFAULTS = {
  ...CAR_DEFAULTS,
  length: 10,
  camdist: 16,
  camheight: 6.5,
  aimy: 2.4,
  fov: 62,
  follow: 12,
  speed: 1,          // tezlik ko'paytirgichi: 1 = oddiy, 2 = ikki baravar tez (0.5 .. 3)
  rocket: 0,         // 1 = raketa o'rnatilgan (o'yinda raketa tugmasi chiqadi)
  rocketx: 0,        // raketaning o'ng tomondagi joyi (metr); chap tomonga o'zi aks etadi
  rockety: 0,        // balandligi (metr)
  rocketz: 0,        // oldi-orqasi (metr, + burun tomon)
  rocketsize: 2.4,   // raketa uzunligi (metr)
};
const AIRPORT_KEYS = Object.keys(AIRPORT_DEFAULTS);

export function parseAirportList(text) {
  const list = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'name') { cur = { name: val, file: '', kind: '', ...AIRPORT_DEFAULTS }; list.push(cur); }
    else if (!cur) continue;
    else if (key === 'airplane') { cur.file = val; cur.kind = 'airplane'; }
    else if (key === 'helicopter') { cur.file = val; cur.kind = 'helicopter'; }
    else if (AIRPORT_KEYS.includes(key)) {
      const n = Number(val);
      cur[key] = Number.isFinite(n) && (key !== 'length' || n > 0) ? n : AIRPORT_DEFAULTS[key];
    }
  }
  return list.filter((a) => a.name && a.file && a.kind);
}
export function serializeAirportList(list) {
  return list.map((a) => {
    const lines = [`name: ${a.name}`, `${a.kind}: ${a.file}`];
    for (const key of AIRPORT_KEYS) {
      const v = Number(a[key]);
      if (Number.isFinite(v) && Math.abs(v - AIRPORT_DEFAULTS[key]) > 1e-9) lines.push(`${key}: ${Math.round(v * 1000) / 1000}`);
    }
    return lines.join('\n');
  }).join('\n\n') + '\n';
}
export async function fetchAirportList() {
  try {
    const res = await fetch('airport.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    return parseAirportList(await res.text());
  } catch { return []; }
}

export function loadAirportDraft(name) {
  try {
    const d = JSON.parse(localStorage.getItem(KEYS.airportDraft + name));
    if (!d || typeof d !== 'object') return {};
    const out = {};
    for (const key of AIRPORT_KEYS) if (Number.isFinite(Number(d[key]))) out[key] = Number(d[key]);
    return out;
  } catch { return {}; }
}
export function saveAirportDraft(name, profile) {
  try { localStorage.setItem(KEYS.airportDraft + name, JSON.stringify(profile)); return true; } catch { return false; }
}

export function loadSelectedAirportName() {
  try { return localStorage.getItem(KEYS.airport) || ''; } catch { return ''; }
}
export function saveSelectedAirportName(name) {
  try { localStorage.setItem(KEYS.airport, name); return true; } catch { return false; }
}

export function cameraPose(p, carX, carZ, heading, speed, distOffset = 0) {
  const dist = p.camdist + distOffset;
  const height = Math.max(1.6, p.camheight + distOffset * 0.32);
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = -Math.cos(heading), rz = Math.sin(heading);
  const side = -p.carx;
  const ahead = 4 - p.carz;
  return {
    px: carX - fx * dist + rx * side, py: height, pz: carZ - fz * dist + rz * side,
    lx: carX + fx * ahead + rx * side, ly: p.aimy, lz: carZ + fz * ahead + rz * side,
    fov: p.fov + Math.min(Math.max(speed, 0), 42) * p.fovspeed,
  };
}

export function loadCarDraft(name) {
  try {
    const d = JSON.parse(localStorage.getItem(KEYS.carDraft + name));
    if (!d || typeof d !== 'object') return {};
    const out = {};
    for (const key of CAR_KEYS) if (Number.isFinite(Number(d[key]))) out[key] = Number(d[key]);
    if (Array.isArray(d.lights)) out.lights = d.lights.slice(0, MAX_LIGHTS).map(normalizeLight);
    return out;
  } catch { return {}; }
}
export function saveCarDraft(name, profile) {
  try { localStorage.setItem(KEYS.carDraft + name, JSON.stringify(profile)); return true; } catch { return false; }
}

export function loadSelectedCarName() {
  try { return localStorage.getItem(KEYS.car) || ''; } catch { return ''; }
}
export function saveSelectedCarName(name) {
  try { localStorage.setItem(KEYS.car, name); return true; } catch { return false; }
}

// ---------- Katalog ----------
export const CATALOG = {
  // Eski to'rtburchak uylar: palitradan olib tashlangan, zonadan ham chiqarib tashlanadi (dropRemoved).
  // Turlar faqat eski zone.json fayllari yiqilmasligi uchun katalogda qoldirilgan.
  house_small:   { label: 'Kichik uy',         group: 'Uylar',     kind: 'house', hw: 4,  hd: 4,   legacy: true },
  house_two:     { label: 'Ikki qavatli uy',   group: 'Uylar',     kind: 'house', hw: 5,  hd: 4.5, legacy: true },
  shop:          { label: 'Do‘kon',            group: 'Uylar',     kind: 'house', hw: 6,  hd: 4.5, legacy: true },
  tower:         { label: 'Baland bino',       group: 'Uylar',     kind: 'house', hw: 7,  hd: 7,   legacy: true },
  house_json:    { label: 'JSON uy',           group: 'Uylar',     kind: 'house', hw: 5,  hd: 5, glb: true, json: true },   // home-json.txt dagi JSON uy (fayl: o.m, masalan baland-bino.json)
  house_glb:     { label: 'GLB uy',            group: 'Uylar',     kind: 'house', hw: 5,  hd: 5, glb: true },   // home-glb.txt dagi GLB uy (model fayli: o.m)
  model_glb:     { label: 'GLB model',         group: 'Modellar',  kind: 'house', hw: 5,  hd: 5, glb: true },   // modellar.txt dagi GLB model (fayl: o.m, k: 0 bo'lsa to'qnashuvsiz)
  tree_pine:     { label: 'Archa',             group: 'Daraxtlar', kind: 'tree',  r: 0.6 },
  tree_round:    { label: 'Bargli daraxt',     group: 'Daraxtlar', kind: 'tree',  r: 0.6 },
  road_straight: { label: 'Yo‘l',              group: 'Yo‘llar',   kind: 'road',  hw: 6,  hd: 12 },
  road_cross:    { label: 'Chorraha',          group: 'Yo‘llar',   kind: 'road',  hw: 6,  hd: 6 },
  ramp_up:       { label: 'Rampa (3 m ko‘tariladi)', group: 'Rampa', kind: 'ramp',  hw: 6,  hd: 12, rise: 3 },
  ramp_flat:     { label: 'Baland yo‘l',       group: 'Rampa',     kind: 'ramp',  hw: 6,  hd: 12, rise: 0 },
  mountain_big:  { label: 'Tog‘',              group: 'Tabiat',    kind: 'mountain', r: 28 },
  mountain_small:{ label: 'Kichik tog‘',       group: 'Tabiat',    kind: 'mountain', r: 15 },
  hill:          { label: 'Qir (tepalik)',     group: 'Tabiat',    kind: 'mountain', r: 12 },
  ridge:         { label: 'Uzun adir',         group: 'Tabiat',    kind: 'ridge',    hw: 18, hd: 7 },
  rock:          { label: 'Tosh',              group: 'Tabiat',    kind: 'mountain', r: 2.2 },
  land_grass:    { label: 'O‘tloq maydon',     group: 'Yer',       kind: 'land',     hw: 20, hd: 20 },
  land_sand:     { label: 'Qum maydon',        group: 'Yer',       kind: 'land',     hw: 20, hd: 20 },
  land_dirt:     { label: 'Tuproq maydon',     group: 'Yer',       kind: 'land',     hw: 20, hd: 20 },
  land_asphalt:  { label: 'Asfalt maydon',     group: 'Yer',       kind: 'land',     hw: 20, hd: 20 },
  billboard:     { label: 'Reklama ekrani',    group: 'Reklama',   kind: 'billboard', hw: 1.1, hd: 0.8 },
  traffic_light: { label: 'Svetofor',          group: 'Yo‘llar',   kind: 'traffic_light', hw: 0.5, hd: 0.5 },
  route_point:   { label: 'Marshrut nuqtasi',  group: 'Marshrut',  kind: 'route' },
  spawn:         { label: 'Boshlanish nuqtasi', group: 'Belgi',    kind: 'spawn' },
};
export const GROUPS = ['Uylar', 'Modellar', 'Daraxtlar', 'Tabiat', 'Yer', 'Yo‘llar', 'Rampa', 'Reklama', 'Marshrut', 'Belgi'];

// Har bir obyektga tasodifiy och rang berish uchun (asl ranglarga ko'paytiriladi).
export const TINTS = {
  house: ['#ffffff', '#ffe6cf', '#d9e8ff', '#e4ffd9', '#ffd9e2', '#f1e2ff'],
  tree:  ['#ffffff', '#e2ffd2', '#c9e6b0', '#f3ffcf'],
  road:  ['#ffffff'],
  ramp:  ['#ffffff'],
  mountain: ['#ffffff', '#e6ece0', '#eadfd2', '#dfe6ee'],
  ridge:    ['#ffffff', '#e6ece0', '#eadfd2', '#dfe6ee'],
  land:     ['#ffffff'],
  billboard: Array.from({ length: 10 }, () => '#ffffff'),
  traffic_light: ['#ffffff'],
  route:    ['#ff5252', '#4b7bec', '#f7b731', '#20bf6b', '#a55eea', '#fd9644', '#26de81', '#fc5c65', '#45aaf2', '#eb3b5a', '#8854d0', '#3867d6'],
  spawn: ['#ffffff'],
};
export function randomTint(type, rnd = Math.random) {
  return Math.floor(rnd() * TINTS[CATALOG[type].kind].length);
}

// Eski (to'rtburchak) va GLB uylarni zona ro'yxatidan chiqarib tashlaydi. JSON uylar (house_json) qoladi.
export function isRemovedType(t) {
  return t === 'house_glb' || !!(CATALOG[t] && CATALOG[t].legacy);
}
export function dropRemoved(list) {
  return (Array.isArray(list) ? list : []).filter((o) => o && !isRemovedType(o.t));
}

export function hasType(t) {
  return Object.prototype.hasOwnProperty.call(CATALOG, t);
}

export function isValidZone(z) {
  return !!z && Array.isArray(z.objects) && z.objects.length <= MAX_OBJECTS &&
    z.objects.every(o => o && hasType(o.t) && Number.isFinite(+o.x) && Number.isFinite(+o.z));
}

// GLB uylar: kattalik (s) va balandlik (y, metr) chegaralari. s = 1 bo'lganda uyning eng uzun tomoni `size` metr bo'ladi.
export const GLB_HOUSE = { size: 10, sMin: 0.05, sMax: 40, yMin: -10, yMax: 60, yStep: 0.5 };

export const RAMP_STEP = 3;
export const RAMP_MAX = 30;

// ---------- Burilish (yo'l/rampani bir necha gradusga qiyshaytirish, 90° burish emas) ----------
// Qo'shilganda yo'l/rampa bo'lagining o'zi ozgina yoy shaklida buriladi, shu bois ketma-ket
// qo'yilgan bo'laklar burchakda "sinib" qolmay, silliq qayrilma hosil qiladi.
export const BEND_TYPES = new Set(['road_straight', 'ramp_up', 'ramp_flat']);
export const BEND_ANGLE = Math.PI / 12; // 15° — bitta bo'lakning boshi bilan oxiri orasidagi burchak
export const isBendable = (t) => BEND_TYPES.has(t);

// ---------- Svetofor: 3 ta chiroq (qizil/sariq/yashil), har birining o'z joyi va soniyasi ----------
export const TRAFFIC_LIGHT_COLORS = ['red', 'yellow', 'green'];
export const TRAFFIC_LIGHT_HEX = { red: '#ff3b30', yellow: '#ffcc00', green: '#33cc66' };
export const TRAFFIC_LIGHT_DIM = { red: '#4a1210', yellow: '#4a3a10', green: '#123a1f' };
// Chiroqni qutining ichida qo'lda surish uchun chegara (mahalliy koordinata, metr).
export const TRAFFIC_HEAD = { minDx: -0.3, maxDx: 0.3, minDy: 0, maxDy: 2.2 };
export const TRAFFIC_SEC_MIN = 1;
export const TRAFFIC_SEC_MAX = 60;

export function defaultTrafficLights() {
  return [
    { color: 'red', dx: 0, dy: 1.8, sec: 5 },
    { color: 'yellow', dx: 0, dy: 1.1, sec: 2 },
    { color: 'green', dx: 0, dy: 0.4, sec: 5 },
  ];
}
function normalizeTrafficLight(o, def) {
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    color: def.color,
    dx: num(o && o.dx, def.dx, TRAFFIC_HEAD.minDx, TRAFFIC_HEAD.maxDx),
    dy: num(o && o.dy, def.dy, TRAFFIC_HEAD.minDy, TRAFFIC_HEAD.maxDy),
    sec: num(o && o.sec, def.sec, TRAFFIC_SEC_MIN, TRAFFIC_SEC_MAX),
  };
}
// Berilgan vaqt (soniya)da qaysi chiroq (0/1/2 indeks) yonganini hisoblaydi.
// "start" - qaysi chiroqdan boshlab yonadi (0=qizil,1=sariq,2=yashil); shu orqali
// chorrahadagi qarama-qarshi svetoforlarga boshqa "start" berib, ularni navbat bilan yondirish mumkin.
export function trafficActiveIndex(lights, start, timeSec) {
  const total = lights.reduce((a, l) => a + l.sec, 0) || 1;
  let t = ((timeSec % total) + total) % total;
  const s = ((start % 3) + 3) % 3;
  for (let k = 0; k < 3; k++) {
    const idx = (s + k) % 3;
    if (t < lights[idx].sec) return idx;
    t -= lights[idx].sec;
  }
  return s;
}

export function normalizeObject(o) {
  const def = CATALOG[o.t];
  const kind = def.kind;
  const tints = TINTS[kind].length;
  const s = Number(o.s);
  const out = {
    t: o.t,
    x: Number(o.x),
    z: Number(o.z),
    r: Number.isFinite(Number(o.r)) ? Number(o.r) : 0,
    s: kind === 'ramp' ? 1 : (Number.isFinite(s) && s > 0 ? s : 1),
    c: Math.abs(Math.floor(Number(o.c) || 0)) % tints,
  };
  if (kind === 'ramp') {
    const min = def.rise === 0 ? RAMP_STEP : 0;
    out.y = Math.min(RAMP_MAX, Math.max(min, Math.round((Number(o.y) || 0) / RAMP_STEP) * RAMP_STEP));
  }
  if (def.glb) {
    // GLB uy: model fayli (m), balandligi (y, metr), model o'lchamidan olingan yarim eni/bo'yi (w, d: s = 1 da)
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    out.m = String(o.m || '').slice(0, 120);
    if (o.k === 0 || o.k === false || o.k === '0') out.k = 0;   // k: 0 - to'qnashuvsiz model (asfalt, qir kabi yassi narsalar)
    out.s = clamp(out.s, GLB_HOUSE.sMin, GLB_HOUSE.sMax);
    const y = Number(o.y);
    out.y = Number.isFinite(y) ? clamp(Math.round(y * 10) / 10, GLB_HOUSE.yMin, GLB_HOUSE.yMax) : 0;
    const w = Number(o.w), d = Number(o.d);
    if (Number.isFinite(w) && w > 0) out.w = clamp(Math.round(w * 100) / 100, 0.5, 80);
    if (Number.isFinite(d) && d > 0) out.d = clamp(Math.round(d * 100) / 100, 0.5, 80);
  }
  if (isBendable(o.t)) {
    // -1 = chapga, 0 = to'g'ri, 1 = o'ngga qayrilma
    const b = Math.round(Number(o.bend));
    out.bend = Number.isFinite(b) ? Math.max(-1, Math.min(1, b)) : 0;
  }
  if (kind === 'traffic_light') {
    const defs = defaultTrafficLights();
    const srcLights = Array.isArray(o.lights) ? o.lights : [];
    out.lights = defs.map((def2, i) => normalizeTrafficLight(srcLights[i], def2));
    out.start = Math.abs(Math.floor(Number(o.start) || 0)) % 3;
  }
  return out;
}

// ---------- Reklama ekranlari: billboard.txt ----------
export const BILLBOARD_SCREEN = { w: 12, h: 6, y: 12.5, z: 0.43 };

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
  for (const file of ['billboard.txt', 'billiboard.txt']) {
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (res.ok) return parseBillboardList(await res.text());
    } catch { /* keyingi nomni sinaymiz */ }
  }
  return [];
}

// ---------- Ob-havo: ob-havo.txt ----------
const ON_VALUES = new Set(['on', '1', 'true', 'ha', 'yoqilgan', 'yoqiq']);
export function parseWeather(text) {
  const w = { rain: false, snow: false, wind: false, day: false, night: false };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/[^a-z]/g, '');
    const on = ON_VALUES.has(m[2].trim().toLowerCase());
    if (key === 'yomgir' || key === 'rain') w.rain = on;
    else if (key === 'qor' || key === 'snow') w.snow = on;
    else if (key === 'shamol' || key === 'wind') w.wind = on;
    else if (key === 'kun' || key === 'day') w.day = on;
    else if (key === 'tun' || key === 'night') w.night = on;
  }
  return w;
}
export async function fetchWeather() {
  for (const file of ['ob-havo.txt', 'obhavo.txt']) {
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (res.ok) return parseWeather(await res.text());
    } catch { /* keyingi nomni sinaymiz */ }
  }
  return { rain: false, snow: false, wind: false, day: false, night: false };
}

// ---------- Botlar: bot-car.txt ----------
export const DEFAULT_BOT_CFG = {
  count: 0,
  speedKmh: 60,
  patience: 20,
  razgon: true,
  route: 'avto',
  bans: new Set(),
};
export async function fetchBotConfig() {
  const cfg = { count: 0, speedKmh: 60, patience: 20, razgon: true, route: 'avto', bans: new Set() };
  try {
    const res = await fetch('bot-car.txt', { cache: 'no-store' });
    if (!res.ok) return cfg;
    for (const raw of (await res.text()).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Za-z_]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'botlar') cfg.count = Math.max(0, Math.min(400, Math.round(Number(val) || 0)));   // jami havzadagi bot soni (ekranga chiqadigani botFleet.js da qat'iy chegaralanadi)
      else if (key === 'tezlik') cfg.speedKmh = Math.max(20, Math.min(120, Number(val) || 60));
      else if (key === 'sabr') cfg.patience = Math.max(5, Math.min(60, Number(val) || 20));
      else if (key === 'razgon') cfg.razgon = ON_VALUES.has(val.toLowerCase());
      else if (key === 'marshrut') cfg.route = ['avto', 'yol', 'qolda'].includes(val.toLowerCase()) ? val.toLowerCase() : 'avto';   // avto: qo'lda nuqta bo'lsa o'sha, bo'lmasa yo'llardan; yol: doim yo'llardan; qolda: faqat nuqtalardan
      else if (key === 'bot_ban') cfg.bans.add(val.toLowerCase());
    }
  } catch { /* fayl yo'q */ }
  return cfg;
}

// ---------- Marshrutlar (botlar uchun) ----------
// route_point obyektlari bir xil "c" (rang/tartib) bo'yicha guruhlanadi.
// Har bir guruhda kamida 3 ta nuqta bo'lsa, undan yopiq halqa marshrut quriladi.
export const LANE_OFFSET = 3;    // yo'l markazidan o'ng polosagacha masofa, metr

export function buildRoutes(objects) {
  const groups = new Map();
  for (const o of objects) {
    if (o.t !== 'route_point') continue;
    const key = o.c || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const routes = [];
  for (const [c, pts] of groups) {
    if (pts.length < 3) continue;
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.001) continue;
      segs.push({ a, b, dx, dz, len, dirx: dx / len, dirz: dz / len });
      total += len;
    }
    if (segs.length < 3) continue;
    routes.push({ c, points: pts, segs, total });
  }
  return routes;
}

// ---------- Avtomatik marshrut: editorda qo'yilgan YO'LLARDAN (marshrut nuqtasi kerak emas) ----------
// road_straight (burilgani ham) va road_cross dan graf quriladi. Bot chorrahada to'g'ri/o'ngga/chapga tasodifiy buriladi,
// oxirida esa o'ziga qaytib keluvchi yopiq halqa bo'ladi (tupik bo'lsa, u yerda burilib qaytadi).
function _routeFromPoints(c, pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) continue;
    segs.push({ a, b, dx, dz, len, dirx: dx / len, dirz: dz / len });
    total += len;
  }
  return segs.length >= 3 ? { c, points: pts, segs, total } : null;
}

export function buildAutoRoutes(objects, maxRoutes = 8) {
  const SNAP = 3;   // shu masofadagi yo'l uchlari bitta tugun deb hisoblanadi
  const nodes = [];
  const nodeAt = (x, z) => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - x, nodes[i].z - z) < SNAP) return i;
    nodes.push({ x, z });
    return nodes.length - 1;
  };
  const edges = [];  // yo'nalishli qirralar: {from, to, pts, rev}
  const addEdge = (pts) => {
    if (pts.length < 2) return;
    const a = nodeAt(pts[0].x, pts[0].z), b = nodeAt(pts[pts.length - 1].x, pts[pts.length - 1].z);
    if (a === b) return;
    const i = edges.length;
    edges.push({ from: a, to: b, pts, rev: i + 1 });
    edges.push({ from: b, to: a, pts: pts.slice().reverse(), rev: i });
  };

  // Burilgan yo'l markaziy chizig'i (models.js dagi bendPoints bilan bir xil)
  const N = 6;
  const crosses = [];
  for (const o of objects) {
    const def = CATALOG[o.t];
    if (!def) continue;
    const s = o.s || 1;
    if (o.t === 'road_straight') {
      const hd = def.hd * s, bend = o.bend || 0;
      const dYaw = (BEND_ANGLE * bend) / N, dL = (2 * hd) / N;
      let lx = 0, lz = -hd, yaw = 0;
      const local = [{ x: lx, z: lz }];
      for (let i = 0; i < N; i++) {
        const mid = yaw + dYaw / 2;
        lx += Math.sin(mid) * dL; lz += Math.cos(mid) * dL; yaw += dYaw;
        local.push({ x: lx, z: lz });
      }
      const cs = Math.cos(o.r), sn = Math.sin(o.r);
      addEdge(local.map((p) => ({ x: o.x + p.x * cs + p.z * sn, z: o.z - p.x * sn + p.z * cs })));
    } else if (o.t === 'road_cross') {
      crosses.push({ x: o.x, z: o.z, reach: def.hd * s + SNAP + 1 });
    }
  }
  // Chorraha: unga yetib kelgan yo'l uchlarini markaz bilan tutashtiramiz
  const ends = nodes.map((n) => ({ x: n.x, z: n.z }));
  for (const cr of crosses) {
    for (const e of ends) {
      if (Math.hypot(e.x - cr.x, e.z - cr.z) < cr.reach) addEdge([{ x: e.x, z: e.z }, { x: cr.x, z: cr.z }]);
    }
  }
  if (edges.length < 2) return [];

  const out = nodes.map(() => []);
  edges.forEach((e, i) => out[e.from].push(i));
  const tangentIn = (e) => { const p = e.pts, a = p[p.length - 2], b = p[p.length - 1]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
  const tangentOut = (e) => { const a = e.pts[0], b = e.pts[1]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
  // Qirradan keyin borish mumkin bo'lgan qirralar (orqaga qaytish faqat tupikda)
  const succ = edges.map((e) => {
    const list = out[e.to].filter((j) => j !== e.rev);
    return list.length ? list : [e.rev];
  });

  // Tasodifiy, lekin har safar bir xil natija (seed)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const used = new Array(edges.length).fill(0);
  const routes = [];
  const wantRoutes = Math.max(2, Math.min(maxRoutes, Math.ceil(edges.length / 8)));
  const WALK = 14;   // har marshrut taxminan shuncha qirradan iborat (keyin yopiladi)

  for (let r = 0; r < wantRoutes * 3 && routes.length < wantRoutes; r++) {
    // eng kam ishlatilgan qirradan boshlaymiz: hamma yo'l qoplansin
    let start = 0;
    for (let i = 1; i < edges.length; i++) if (used[i] < used[start]) start = i;
    const seq = [start];
    let cur = start;
    for (let k = 0; k < WALK; k++) {
      const opts = succ[cur];
      if (opts.length === 1) cur = opts[0];
      else {
        const t = tangentIn(edges[cur]);
        const scored = opts.map((j) => { const u = tangentOut(edges[j]); return { j, w: (0.25 + Math.max(0, t.x * u.x + t.z * u.z)) / (1 + used[j]) }; });
        let sum = 0; for (const s of scored) sum += s.w;
        let pick = rnd() * sum, chosen = scored[0].j;
        for (const s of scored) { pick -= s.w; if (pick <= 0) { chosen = s.j; break; } }
        cur = chosen;
      }
      seq.push(cur);
    }
    // Boshiga qaytish: eng qisqa yo'l (BFS)
    if (cur !== start) {
      const prev = new Map([[cur, null]]);
      const queue = [cur];
      let found = false;
      for (let qi = 0; qi < queue.length && !found; qi++) {
        for (const j of succ[queue[qi]]) {
          if (prev.has(j)) continue;
          prev.set(j, queue[qi]);
          if (j === start) { found = true; break; }
          queue.push(j);
        }
      }
      if (!found) continue;
      const back = [];
      for (let e = prev.get(start); e !== null && e !== cur; e = prev.get(e)) back.push(e);
      back.reverse();
      seq.push(...back);
    } else seq.pop();   // start ga o'zi qaytib kelgan
    // (BFS "start" ni qo'shmaydi: u halqa boshi bo'lib qoladi)

    const pts = [];
    for (const ei of seq) {
      used[ei]++;
      const p = edges[ei].pts;
      for (let i = 0; i < p.length - 1; i++) {   // qirraning oxirgi nuqtasi keyingining boshi
        const q = p[i], last = pts[pts.length - 1];
        if (!last || Math.hypot(last.x - q.x, last.z - q.z) > 0.01) pts.push({ x: q.x, z: q.z });
      }
    }
    const route = _routeFromPoints(1000 + routes.length, pts);
    if (route && route.total > 40) routes.push(route);
  }
  return routes;
}

export function pointOnRoute(route, s) {
  if (!route.segs.length) return { x: 0, z: 0, dirx: 0, dirz: 1 };
  let t = ((s % route.total) + route.total) % route.total;
  for (const seg of route.segs) {
    if (t <= seg.len) {
      const k = t / seg.len;
      return {
        x: seg.a.x + seg.dx * k,
        z: seg.a.z + seg.dz * k,
        dirx: seg.dirx,
        dirz: seg.dirz,
      };
    }
    t -= seg.len;
  }
  const last = route.segs[route.segs.length - 1];
  return { x: last.b.x, z: last.b.z, dirx: last.dirx, dirz: last.dirz };
}

// Botlarni boshqarish: marshrut bo'ylab yuradi, to'siqni ko'rsa sekinlashadi,
// sabri tugasa chap polosaga chiqib oldinlab o'tadi, uzoq tiqilsa keyingi nuqtaga sakraydi.
export function stepBot(bot, route, objects, obstacles, dt, cfg) {
  const fx = bot.dirx, fz = bot.dirz;
  const rx = -fz, rz = fx;
  const lookAhead = 6 + bot.speed * 1.5;

  // Oldindagi to'siqni aniqlash
  let blocker = null;
  let blockerDist = Infinity;
  for (const o of obstacles) {
    const dx = o.x - bot.x, dz = o.z - bot.z;
    const along = dx * fx + dz * fz;
    if (along < 0.5 || along > lookAhead) continue;
    const lat = Math.abs(dx * rx + dz * rz);
    if (lat > 2.5) continue;
    if (along < blockerDist) { blockerDist = along; blocker = o; }
  }

  // Yon tomon (chap polosa) bo'shligini tekshirish
  let sideClear = true;
  const sideAhead = 7;
  const sideX = bot.x + fx * sideAhead - rx * LANE_OFFSET * 2.5;
  const sideZ = bot.z + fz * sideAhead - rz * LANE_OFFSET * 2.5;
  for (const o of objects) {
    const def = CATALOG[o.t];
    if (!def) continue;
    const k = def.kind;
    if (k !== 'house' && k !== 'mountain' && k !== 'tree' && k !== 'ridge' && k !== 'billboard') continue;
    const dx = o.x - sideX, dz = o.z - sideZ;
    const reach = (def.r || Math.max(def.hw || 0, def.hd || 0)) * o.s + 2;
    if (dx * dx + dz * dz < reach * reach) { sideClear = false; break; }
  }

  // Sabr vaqti
  if (blocker) bot.waitTimer += dt;
  else bot.waitTimer = Math.max(0, bot.waitTimer - dt * 3);

  // O'tishga qaror
  const canStart = cfg.razgon && !bot.overtaking && bot.waitTimer > cfg.patience && sideClear && bot.speed > 3;
  if (canStart) {
    bot.overtaking = true;
    bot.overtakeTimer = 0;
    bot.lateralTarget = -LANE_OFFSET * 1.9;
  }
  if (bot.overtaking) {
    bot.overtakeTimer = (bot.overtakeTimer || 0) + dt;
    if (!blocker && bot.overtakeTimer > 1.5) {
      bot.lateralTarget = LANE_OFFSET;
      if (Math.abs(bot.lateral - LANE_OFFSET) < 0.4) {
        bot.overtaking = false;
        bot.waitTimer = 0;
      }
    }
    if (bot.overtakeTimer > 8) {
      bot.lateralTarget = LANE_OFFSET;
      if (Math.abs(bot.lateral - LANE_OFFSET) < 0.4) bot.overtaking = false;
    }
  }

  // Lateral silliq harakat
  bot.lateral += (bot.lateralTarget - bot.lateral) * Math.min(1, dt * 2.5);

  // Tezlikni boshqarish
  const baseSpeed = (cfg.speedKmh / 3.6);
  const maxSpeed = baseSpeed * 1.35;
  let target;
  if (bot.overtaking) target = maxSpeed;
  else if (blocker && blockerDist < 12) target = Math.max(1.5, (blocker.speed || 0) * 0.85);
  else target = baseSpeed;

  const accel = bot.overtaking ? 10 : 4;
  const brake = 12;
  if (bot.speed < target) bot.speed = Math.min(target, bot.speed + accel * dt);
  else bot.speed = Math.max(target, bot.speed - brake * dt);
  bot.speed = Math.max(0, Math.min(bot.speed, maxSpeed));

  const braking = !!blocker && blockerDist < 10 && bot.speed > 1;

  // Marshrut bo'ylab harakat
  bot.s += bot.speed * dt;
  const pos = pointOnRoute(route, bot.s);
  const prx = -pos.dirz, prz = pos.dirx;
  bot.x = pos.x + prx * bot.lateral;
  bot.z = pos.z + prz * bot.lateral;
  bot.dirx = pos.dirx;
  bot.dirz = pos.dirz;

  // Uzoq tiqilib qolsa: marshrutning keyingi qismiga sakrash
  if (bot.waitTimer > 60) {
    const jump = pointOnRoute(route, bot.s + 25);
    bot.x = jump.x; bot.z = jump.z;
    bot.s += 25;
    bot.waitTimer = 0;
    bot.overtaking = false;
    bot.overtakeTimer = 0;
    bot.lateral = LANE_OFFSET;
    bot.lateralTarget = LANE_OFFSET;
  }

  return { dirx: pos.dirx, dirz: pos.dirz, braking };
}

// ---------- Rampalar (balandlik) ----------
export function makeRamp(o) {
  const def = CATALOG[o.t];
  if (!def || def.kind !== 'ramp') return null;
  const bend = isBendable(o.t) ? (o.bend || 0) : 0;
  // Burilgan rampa markazdan ozgina yon tomonga qayriladi; qoplov radiusini shunga moslab kengaytiramiz,
  // shu bois harakat va balandlik hisobi qayrilma yoyining hammasini qamrab oladi.
  const hw = def.hw + (bend ? 3 : 0), hd = def.hd, reach = Math.hypot(hw, hd) + 3;
  return {
    shape: 'box', x: o.x, z: o.z, hw, hd, cos: Math.cos(o.r), sin: Math.sin(o.r),
    base: o.y || 0, rise: def.rise, reach2: reach * reach,
  };
}
export function rampSurface(r, x, z) {
  const dx = x - r.x, dz = z - r.z;
  const lx = dx * r.cos - dz * r.sin;
  const lz = dx * r.sin + dz * r.cos;
  if (Math.abs(lx) > r.hw || Math.abs(lz) > r.hd) return null;
  return r.base + (r.rise * (lz + r.hd)) / (2 * r.hd);
}
export function rampSurfaceNear(r, x, z) {
  const dx = x - r.x, dz = z - r.z;
  const lz = Math.max(-r.hd, Math.min(r.hd, dx * r.sin + dz * r.cos));
  return r.base + (r.rise * (lz + r.hd)) / (2 * r.hd);
}
export function groundHeightAt(ramps, x, z) {
  let h = 0;
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > r.reach2) continue;
    const s = rampSurface(r, x, z);
    if (s !== null && s > h) h = s;
  }
  return h;
}

// ---------- Toqnashuv ----------
export function makeFootprint(o) {
  const def = CATALOG[o.t];
  if (!def || def.kind === 'spawn' || def.kind === 'route') return null;
  if (def.kind === 'tree' || def.kind === 'mountain') {
    const r = def.r * o.s;
    return { shape: 'circle', solid: true, x: o.x, z: o.z, r, reach2: (r + 3) * (r + 3) };
  }
  const hw = (o.w || def.hw) * o.s, hd = (o.d || def.hd) * o.s;   // GLB uyda w/d model o'lchamidan keladi
  const reach = Math.hypot(hw, hd) + 3;
  return {
    shape: 'box', solid: (def.kind === 'house' || def.kind === 'billboard' || def.kind === 'ridge') && o.k !== 0, x: o.x, z: o.z, hw, hd,
    cos: Math.cos(o.r), sin: Math.sin(o.r), reach2: reach * reach,
  };
}
export function makeCollider(o) {
  const f = makeFootprint(o);
  return f && f.solid ? f : null;
}

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

  // Uylar endi home-json.txt dagi JSON modellardan editorda qo'yiladi: namuna zonada uy yo'q.

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