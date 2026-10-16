// DEXO GTA: havo harakati - qo'lda chizilgan yo'llar bo'ylab uchadigan AI samolyot va vertolyotlar.
//
// Yo'llar editorda chiziladi va zone.json ichida "air" ro'yxatida saqlanadi:
//   air: [{ type: 'plane' | 'heli', model?: 'airport.txt dagi nom', count: 1..6, speed?: m/s,
//           pad?: [x, z], pts: [[x, z, balandlik], ...] }]
//   pad - uchish/qo'nish joyi: yo'lning 1-nuqtasi shu joyda (yerda), bot shu yerdan ko'tariladi,
//         aylanib kelib shu yerga qo'nadi va yana uchadi.
//
//   combat: true - JANGOVOR bot. U yo'l bo'ylab UCHMAYDI: belgilangan joyda (pad yoki 1-nuqta; band bo'lsa AI atrofdan
//         bo'sh joy topadi) JIM turadi. O'yinchi mashina, samolyot yoki vertolyotdan raketa otsa (airFleet.alert())
//         bot dvigatelini yurgizib uchadi va o'yinchiga hujum qiladi: xaritaning istalgan joyiga (zona chegarasigacha)
//         boradi, to'siqlarni (tog', bino, daraxt) yonidan yoki tepasidan oshib o'tadi. Hujum tugagach joyiga qaytib qo'nadi.
//         post: true - jangovor "joy" (yo'l emas): pts = [[x, z, 0]] faqat bitta nuqta; to'siq tekshiruvi yo'q.
//   runway: [[x, z], [x, z], ...] - UCHISH YO'LAGI (faqat samolyot). Editorda qo'lda chiziladi: 1-nuqta = joy (pad), qolganlari chiziq.
//         Samolyot (jangovor ham, oddiy ham) shu chiziq bo'ylab yuguradi, chiziq tugaganda SEKIN havoga ko'tariladi va o'z
//         yo'nalishida uchadi. Qo'nganda ham shu chiziqqa tushib, sekin tormozlanib to'xtaydi.
//
// ODDIY (jangovor emas) botlar endi haqiqiy pilotdek uchadi: yo'l faqat yo'nalish beradi, bot esa o'zi buriladi (samolyot uchun
// yonboshlash burchagi cheklangan - katta samolyot keskin burilmaydi), balandlikni sekin o'zgartiradi (cheklangan ko'tarilish/tushish
// burchagi), uchish joyidan (pad) yugurib uchadi, qaytib sekin tushib qo'nadi va to'xtaydi; vertolyot tik ko'tariladi va tik qo'nadi.
//
// Qoidalar:
//  - Yo'l har doim YOPIQ halqa (kamida 3 nuqta): bot oxirgi nuqtadan keyin yana birinchisiga o'tadi.
//  - Botlar fizikasiz, tayyor silliq egri chiziq (Catmull-Rom) bo'ylab uchadi.
//  - To'siqlarga (tog', uy, bino, daraxt, rampa) urilmaslik yo'lni OLDINDAN tekshirish bilan ta'minlanadi:
//    egri chiziqning har bir joyi ostidagi eng baland to'siq + xavfsiz zaxira balandlikdan yuqori bo'lishi shart.
//    O'yin yuklanganda xavfli joylar avtomatik ko'tariladi (checkAirPath, fix = true).

import * as THREE from 'three';
import { CATALOG, makeCollider, makeRamp, groundHeightAt } from './data.js';

export const AIR_TYPES = {
  // clearance: to'siq tepasidan kamida shuncha metr yuqorida; margin: to'siq chetidan shuncha metr yon tomonga ham xavfsiz
  plane: { label: 'Samolyot',  minAlt: 40, maxAlt: 400, defAlt: 90, speed: 38, clearance: 18, margin: 12, maxBank: 0.6,  color: 0xff9a2e, spin: 40, padR: 170, padSlow: 0.45, range0: 250, rangeStep: 150,
    // atk: jangovor hujum sozlamalari. speed - hujum tezligi, turn - burilish tezligi (rad/s), climb/sink - ko'tarilish/tushish (m/s),
    // look - to'siqni oldindan ko'rish masofasi (m), minDist - shundan yaqinlashsa o'tib ketib qayta burilish, standoff - vertolyot to'xtab turadigan masofa,
    // fireRange - raketa otish masofasi (m), cone - nishonga shuncha radian aniqlikda qaraganda otadi, cooldown - o'qlar orasi (s), salvo - bir yo'la nechta raketa
    atk: { speed: 66, accel: 14, turn: 0.85, climb: 18, sink: 24, look: 320, minDist: 150, standoff: 0, fireRange: 720, cone: 0.2, cooldown: 3.4, salvo: 2, breakTime: 4.5 },
    // fly: ODDIY (jangovor emas) botning uchish xarakteri. bank - eng katta yonboshlash (rad), climb/dsc - yo'l profilidagi ko'tarilish/tushish
    // nishabi, sink - haqiqiy tushish chegarasi, glide - qo'nish nishabi, gate - qo'nish yo'lagi oldidagi masofa (m), accel/decel - tezlanish (m/s2),
    // brake - qo'ngandan keyingi tormoz, vr - uchish tezligi (kruiz tezligining ulushi), rotate - burun ko'tarilishi (rad), lookT - oldinga qarash (s)
    fly: { bank: 0.42, climb: 0.085, dsc: 0.07, sink: 0.095, glide: 0.065, gate: 1100, accel: 2.6, decel: 3.0, brake: 4.2, vr: 0.62, rotate: 0.13, lookT: 4.5, outT: 12, flareH: 8, wait: [8, 16] } },
  heli:  { label: 'Vertolyot', minAlt: 12, maxAlt: 200, defAlt: 40, speed: 16, clearance: 10, margin: 7,  maxBank: 0.25, color: 0x35d0ff, spin: 25, padR: 45,  padSlow: 0.35, range0: 120, rangeStep: 80,
    atk: { speed: 34, accel: 10, turn: 1.7, climb: 10, sink: 13, look: 140, minDist: 0, standoff: 150, fireRange: 540, cone: 0.16, cooldown: 2.6, salvo: 2, breakTime: 0 },
    fly: { yaw: 0.8, climb: 0.25, dsc: 0.22, accel: 2.6, liftH: 10, landR: 120, wait: [8, 16] } },
};
export const AIR_RUNWAY_MAX_PTS = 8;
export const AIR_MAX_POINTS = 120;   // uzun yo'llarda to'siqni chetlab o'tish uchun ko'proq nuqta kerak (oldin 60)
export const AIR_MAX_PATHS = Infinity;   // yo'llar soni cheksiz (botlar soni o'yinda AIR_BOT_LIMIT bilan cheklanadi)
export const AIR_MAX_BOTS = 6;
export const AIR_COMBAT_MAX = 12;     // bir vaqtda hujum qiladigan jangovor botlarning eng ko'pi (eng yaqinlari chaqiriladi)
export const AIR_COMBAT_HOLD = 45;    // soniya: o'yinchi oxirgi raketa otganidan keyin shuncha vaqt hujum davom etadi
const ROCKET_SPEED = 140;             // rocket.js dagi ROCKET_BOOST bilan bir xil (raketa tezligi, m/s)
const FALLBACK_MOUNT = {              // modelda raketa o'rnatilmagan bo'lsa (airport.txt da rocket: 1 yo'q) shu joydan otadi
  plane: { size: 3.2, power: 1, blast: 16, range: 0, tilt: 0, visual: false, offs: [[1.6, -0.6, 1.0], [-1.6, -0.6, 1.0]] },
  heli:  { size: 2.2, power: 1, blast: 16, range: 0, tilt: 0, visual: false, offs: [[1.0, -0.8, 1.2], [-1.0, -0.8, 1.2]] },
};
const AVOID_OFFS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.4, -2.4];   // to'siqdan qochish: nishon yo'nalishidan og'ish burchaklari
const AIR_MAX_VOICES = 4;   // bir vaqtda eng ko'pi bilan nechta botning ovozi chiqadi (eng yaqinlari) - telefon uchun cheklov
const AIR_VIEW_DIST = 420;   // o'yindagi tuman (fog) 340 m da tugaydi, undan uzoqdagi botni ko'rsatmaymiz

// To'siqlarning balandligi (m). game.js dagi COLLIDER_TOP bilan bir xil.
const TOP = {
  house_small: 6.5, house_two: 9, shop: 6.5, tower: 39, billboard: 17,
  tree_pine: 8.4, tree_round: 7.2,
  mountain_big: 60, mountain_small: 30, hill: 6, rock: 3.4, ridge: 8,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- Yo'lni tozalash (zone.json dan kelgan ma'lumot ishonchsiz bo'lishi mumkin) ----------
export function normalizeAirPath(p) {
  const type = p && p.type === 'heli' ? 'heli' : 'plane';
  const T = AIR_TYPES[type];
  // Uchish/qo'nish joyi (pad): [x, z]. Bo'lsa, yo'l nuqtalari yerga (0.2 m gacha) tushishi mumkin.
  let pad = null;
  if (p && Array.isArray(p.pad) && Number.isFinite(Number(p.pad[0])) && Number.isFinite(Number(p.pad[1]))) pad = [r1(Number(p.pad[0])), r1(Number(p.pad[1]))];
  const post = !!(p && p.combat && p.post);   // jangovor joy: faqat bitta nuqta (yerda), yo'l emas
  const minY = (pad || post) ? 0.2 : 5;
  const pts = [];
  const src = p && Array.isArray(p.pts) ? p.pts : [];
  for (const q of src) {
    if (pts.length >= AIR_MAX_POINTS || !Array.isArray(q)) continue;
    const x = Number(q[0]), z = Number(q[1]), y = Number(q[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last[0], z - last[1]) < 1.5) continue;   // juda yaqin nuqta egri chiziqni buzadi
    pts.push([r1(x), r1(z), r1(clamp(y, minY, T.maxAlt))]);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1.5) pts.pop();
  if (pad && (!pts.length || Math.hypot(pts[0][0] - pad[0], pts[0][1] - pad[1]) > 1.5)) pad = null;   // 1-nuqta padda bo'lmasa, pad yaroqsiz
  // Uchish yo'lagi (faqat samolyot): boshi = joy (pad)
  let runway = null;
  if (type === 'plane' && p && Array.isArray(p.runway)) { const rwb = buildRunway(p.runway); if (rwb) runway = rwb.pts; }
  if (runway) {
    pad = [runway[0][0], runway[0][1]];
    if (!pts.length || Math.hypot(pts[0][0] - pad[0], pts[0][1] - pad[1]) > 1.5) {
      if (post) pts.length = 0;
      pts.unshift([pad[0], pad[1], post ? 0.2 : 0.5]);
      if (pts.length > AIR_MAX_POINTS) pts.length = AIR_MAX_POINTS;
    }
  }
  const out = { type, count: clamp(Math.round(Number(p && p.count) || 1), 1, AIR_MAX_BOTS), pts };
  if (runway) out.runway = runway.map((q) => q.slice());
  if (p && typeof p.model === 'string' && p.model.trim()) out.model = p.model.trim().slice(0, 80);
  if (pad) out.pad = pad;
  if (p && p.combat) out.combat = true;   // jangovor bot
  if (post) out.post = true;
  const sp = Number(p && p.speed);
  if (Number.isFinite(sp) && sp > 0) out.speed = clamp(sp, 4, type === 'heli' ? 30 : 70);
  return out;
}

// ---------- To'siqlar ----------
// Editor uchun: zonadagi obyektlardan to'siqlar ro'yxatini yasaydi (game.js o'zining colliders va ramps ini beradi).
export function buildAirObstacles(objects) {
  const cols = [];
  for (const o of objects) {
    const c = makeCollider(o);
    if (!c) continue;
    c.top = (TOP[o.t] || 8) * (o.s || 1);
    c.cone = !!CATALOG[o.t] && CATALOG[o.t].kind === 'mountain';   // tog' tepaga qarab ingichkalashadi
    cols.push(c);
  }
  return { cols, ramps: objects.map(makeRamp).filter(Boolean), grid: buildGrid(cols) };
}

// Tezlashtirish: to'siqlar katakchalarga bo'linadi, floorAt faqat shu nuqta katagidagilarni tekshiradi.
// Faqat buildAirObstacles (editor) yasaydi; game.js ning o'zgaruvchan colliders ro'yxatida grid yo'q - u eskicha ishlaydi.
const GRID_CELL = 80;
const GRID_PAD = 40;   // margin shundan oshmasa grid ishlatiladi
const gridKey = (gx, gz) => (gx + 32768) * 65536 + (gz + 32768);
function buildGrid(cols) {
  const cells = new Map();
  for (const c of cols) {
    const reach = (c.shape === 'circle' ? c.r : Math.sqrt(c.reach2)) + GRID_PAD;
    if (!Number.isFinite(reach)) return null;   // noaniq o'lcham: grid ishlatmaymiz (to'liq tekshiruv)
    const x0 = Math.floor((c.x - reach) / GRID_CELL), x1 = Math.floor((c.x + reach) / GRID_CELL);
    const z0 = Math.floor((c.z - reach) / GRID_CELL), z1 = Math.floor((c.z + reach) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = gridKey(gx, gz);
        const list = cells.get(k);
        if (list) list.push(c); else cells.set(k, [c]);
      }
    }
  }
  return cells;
}
const NO_COLS = [];

// (x, z) nuqtada havo kemasi kamida qanday balandlikda bo'lishi kerak (margin - yon tomondan zaxira).
export function floorAt(obs, x, z, margin) {
  let h = 0;
  const list = obs.grid && margin <= GRID_PAD
    ? (obs.grid.get(gridKey(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL))) || NO_COLS)
    : obs.cols;
  for (const c of list) {
    const dx = x - c.x, dz = z - c.z;
    if (c.shape === 'circle') {
      const reach = c.r + margin;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      let top = c.top;
      if (c.cone) {                                     // tog': markazdan uzoqlashgan sari pastroq
        const eff = Math.max(0, Math.sqrt(d2) - margin);
        top = c.top * Math.max(0, 1 - eff / c.r);
      }
      if (top > h) h = top;
    } else {
      const reach = Math.sqrt(c.reach2) + margin;
      if (dx * dx + dz * dz > reach * reach) continue;
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) < c.hw + margin && Math.abs(lz) < c.hd + margin && c.top > h) h = c.top;
    }
  }
  if (obs.ramps && obs.ramps.length) {
    const g = groundHeightAt(obs.ramps, x, z);
    if (g > h) h = g;
  }
  return h;
}

// Pad (uchish/qo'nish joyi) ostidagi yer balandligi (rampa bo'lsa, rampa ustida).
export function groundAt(obs, x, z) {
  return obs.ramps && obs.ramps.length ? groundHeightAt(obs.ramps, x, z) : 0;
}
// Pad ustida to'siq (uy, daraxt, tog' ...) bormi? Rampa to'siq hisoblanmaydi (u yer).
export function padBlocked(obs, x, z) {
  return floorAt({ cols: obs.cols, ramps: [] }, x, z, 3) > 0.5;
}

// ---------- Egri chiziq ----------
function makeCurve(pts) {
  const v = pts.map((p) => new THREE.Vector3(p[0], p[2], p[1]));   // (x, balandlik, z)
  const c = new THREE.CatmullRomCurve3(v, true, 'centripetal');
  c.arcLengthDivisions = Math.max(200, v.length * 50);
  return c;
}

// Editorda chizish uchun egri chiziq nuqtalari.
export function sampleAirPath(path, perSeg = 14) {
  const n = path.pts.length;
  if (n < 3) return path.pts.map((q) => new THREE.Vector3(q[0], q[2], q[1]));
  const curve = makeCurve(path.pts);
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < perSeg; f++) out.push(curve.getPoint((i + f / perSeg) / n));
  }
  out.push(out[0].clone());
  return out;
}

function scanPath(pts, obs, T, pad) {
  const n = pts.length;
  const curve = makeCurve(pts);
  const bad = [];
  const worst = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const k = clamp(Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5), 4, 120);   // har ~5 m da tekshiramiz (uzun to'g'ri qismda ham)
    for (let f = 0; f < k; f++) {
      const p = curve.getPoint((i + f / k) / n);
      let margin = T.margin, clr = T.clearance;
      if (pad) {   // pad yaqinida zaxira asta-sekin kamayadi: samolyot/vertolyot yerga qo'na oladi
        const t = clamp(Math.hypot(p.x - pad[0], p.z - pad[1]) / T.padR, 0, 1);
        margin = 2 + (T.margin - 2) * t;
        clr = 0.1 + (T.clearance - 0.1) * t * t;   // pad yonida zaxira deyarli yo'q (egri chiziq yer tomon biroz pastga og'ishi mumkin)
      }
      const need = floorAt(obs, p.x, p.z, margin) + clr;
      if (p.y < need - 0.05) {
        const deficit = need - p.y;
        bad.push({ x: p.x, y: p.y, z: p.z, need });
        if (deficit > worst[i]) worst[i] = deficit;
        if (deficit > worst[(i + 1) % n]) worst[(i + 1) % n] = deficit;
      }
    }
  }
  return { bad, worst };
}

// Yo'lni to'siqlarga nisbatan tekshiradi.
// fix = true bo'lsa, xavfli nuqtalarni ko'taradi (nusxa ustida ishlaydi, asl yo'lga tegmaydi).
// Qaytaradi: { ok, pts, bad: [{x,y,z,need}], raised: ko'tarilgan nuqtalar soni, tooHigh, tooShort }
export function checkAirPath(path, obs, fix = false) {
  const T = AIR_TYPES[path.type] || AIR_TYPES.plane;
  const pts = path.pts.map((p) => [p[0], p[1], p[2]]);
  const n = pts.length;
  const out = { ok: true, pts, bad: [], raised: 0, tooHigh: false, tooShort: n < 3 };
  if (n < 3) { out.ok = false; return out; }
  const pad = path.pad || null;
  if (pad) pts[0][2] = r1(groundAt(obs, pad[0], pad[1]) + 0.5);   // 1-nuqta doim yerda (pad ustida)

  if (fix) {
    const orig = pts.map((p) => p[2]);
    for (let pass = 0; pass < 12; pass++) {
      const { bad, worst } = scanPath(pts, obs, T, pad);
      if (!bad.length) break;
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (worst[i] <= 0) continue;
        if (pad && i === 0) continue;   // pad nuqtasi ko'tarilmaydi - qo'shni nuqtalar ko'tariladi
        const want = pts[i][2] + worst[i] + 2;
        const next = Math.min(want, T.maxAlt);
        if (next > pts[i][2] + 0.01) { pts[i][2] = r1(next); changed = true; }
        if (want > T.maxAlt) out.tooHigh = true;
      }
      if (!changed) break;
    }
    for (let i = 0; i < n; i++) if (pts[i][2] > orig[i] + 0.01) out.raised++;
    out.gain = 0;
    for (let i = 0; i < n; i++) out.gain += Math.max(0, pts[i][2] - orig[i]);   // jami ko'tarilgan balandlik (metr)
  }

  const fin = scanPath(pts, obs, T, pad);
  out.bad = fin.bad;
  out.ok = fin.bad.length === 0;
  if (!out.ok && fix) out.tooHigh = true;   // maksimal balandlikda ham xavfsiz bo'lmadi
  return out;
}

// ---------- Tayyor (oldindan hisoblangan) yo'l: arc-length bo'yicha bir tekis nuqtalar ----------
function bakePath(path) {
  const curve = makeCurve(path.pts);
  const len = curve.getLength();
  const N = Math.max(12, Math.ceil(len / 4));
  const xs = new Float32Array(N), ys = new Float32Array(N), zs = new Float32Array(N);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    curve.getPointAt(i / N, tmp);
    xs[i] = tmp.x; ys[i] = tmp.y; zs[i] = tmp.z;
  }
  return { len, N, step: len / N, xs, ys, zs, pad: !!path.pad };
}

function sampleBaked(b, s, out) {
  const u = (((s % b.len) + b.len) % b.len) / b.step;
  const i = Math.floor(u), f = u - i;
  const i0 = i % b.N, i1 = (i + 1) % b.N;
  out.x = b.xs[i0] + (b.xs[i1] - b.xs[i0]) * f;
  out.y = b.ys[i0] + (b.ys[i1] - b.ys[i0]) * f;
  out.z = b.zs[i0] + (b.zs[i1] - b.zs[i0]) * f;
}

const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// ---------- Uchish yo'lagi (runway) ----------
// raw: [[x, z], ...] -> { pts, seg: [uzunliklar], len, h0 (1-bo'lak yo'nalishi) } yoki null
export function buildRunway(raw) {
  if (!Array.isArray(raw)) return null;
  const pts = [];
  for (const q of raw) {
    if (!Array.isArray(q)) continue;
    const x = Number(q[0]), z = Number(q[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last[0], z - last[1]) < 1) continue;
    pts.push([r1(x), r1(z)]);
    if (pts.length >= AIR_RUNWAY_MAX_PTS) break;
  }
  if (pts.length < 2) return null;
  const seg = [];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l); len += l;
  }
  return { pts, seg, len, h0: Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) };
}
// Yo'lakning boshidan d metr narida: { x, z, h }. Chiziqdan oldin va keyin to'g'ri chiziq davom etadi.
function runwayAt(rw, d, out) {
  const P = rw.pts, n = P.length;
  if (d <= 0) {
    out.x = P[0][0] + Math.sin(rw.h0) * d; out.z = P[0][1] + Math.cos(rw.h0) * d; out.h = rw.h0;
    return out;
  }
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const l = rw.seg[i];
    if (d <= acc + l || i === n - 2) {
      const h = Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      const t = d - acc;
      out.x = P[i][0] + Math.sin(h) * t; out.z = P[i][1] + Math.cos(h) * t; out.h = h;
      return out;
    }
    acc += l;
  }
  return out;
}
// (x, z) nuqta yo'lakning 1-bo'lagi bo'yicha boshidan necha metrda (manfiy = boshidan oldinda)
const rwProject = (rw, x, z) => (x - rw.pts[0][0]) * Math.sin(rw.h0) + (z - rw.pts[0][1]) * Math.cos(rw.h0);

// ---------- Oddiy botlar: tayyor yo'l profili ----------
// Foydalanuvchi chizgan balandliklar (b.ys) va to'siqlar (need) asosida REAL profil yasaydi:
//  - uchish joyi (pad) yaqinida yer ustida, undan uzoqlashgan sari faqat sekin ko'tariladi (F.climb nishab);
//  - joyga qaytishda faqat sekin tushadi (F.dsc nishab);
//  - to'siq ustidan o'tish uchun kerak bo'lsa, ko'tarilish OLDINDAN boshlanadi (keskin sakrash bo'lmaydi).
// Qaytaradi: Float32Array (N ta balandlik). usePad = false bo'lsa, pad hisobga olinmaydi (kruiz balandlikda uchib o'tadi).
function makeProfile(b, path, obs, T, lead, usePad) {
  const N = b.N, ds = b.step, F = T.fly;
  const pad = usePad ? path.pad : null;
  const g0 = pad ? groundAt(obs, pad[0], pad[1]) : 0;
  const alt = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = b.xs[i], z = b.zs[i];
    let margin = T.margin, clr = T.clearance;
    if (pad) {
      const t = clamp(Math.hypot(x - pad[0], z - pad[1]) / T.padR, 0, 1);
      margin = 2 + (T.margin - 2) * t;
      clr = 0.5 + (T.clearance - 0.5) * t;
    }
    const need = floorAt(obs, x, z, margin) + clr;
    let a = b.ys[i];
    if (pad) a = Math.min(a, g0 + 0.5 + F.climb * 0.9 * Math.max(0, i * ds - lead), g0 + 0.5 + F.dsc * 0.9 * (N - i) * ds);
    alt[i] = Math.max(a, need);
  }
  const locked = (i) => !!pad && (i * ds <= lead + 15 || (N - i) * ds <= 15);
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 2 * N - 1; t >= 1; t--) {         // ko'tarilish nishabi: oldingi nuqtalarni ko'taramiz
      const k = t % N, j = (t - 1) % N;
      if (locked(j)) continue;
      const m = alt[k] - F.climb * ds;
      if (m > alt[j]) alt[j] = m;
    }
    for (let t = 1; t < 2 * N; t++) {              // tushish nishabi: keyingi nuqtalarni ko'taramiz
      const k = t % N, j = (t - 1) % N;
      if (locked(k)) continue;
      const m = alt[j] - F.dsc * ds;
      if (m > alt[k]) alt[k] = m;
    }
  }
  return alt;
}

// Yo'l bo'ylab "yoy" koordinatasi: yangi qiymatga o'tadi, lekin bir freymda maxs dan ko'p oldinga, 40 m dan ko'p orqaga siljimaydi
function advanceS(s0, s1, len, maxFwd) {
  let d = ((s1 - s0 + len * 1.5) % len) - len * 0.5;
  d = clamp(d, -40, maxFwd);
  return (((s0 + d) % len) + len) % len;
}

// Yo'ldagi eng yaqin nuqta: oyna [s0 - back, s0 + fwd] ichida qidiriladi. { s, d }
function nearestS(b, x, z, s0, back, fwd) {
  const N = b.N, ds = b.step;
  const i0 = Math.floor(s0 / ds) - Math.ceil(back / ds);
  const n = Math.min(N, Math.ceil((back + fwd) / ds));
  let best = 0, bd = Infinity;
  for (let k = 0; k <= n; k++) {
    const i = (((i0 + k) % N) + N) % N;
    const dx = b.xs[i] - x, dz = b.zs[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return { s: best * ds, d: Math.sqrt(bd) };
}

// ---------- Jangovor botlar uchun joy topish ----------
// Belgilangan nuqta band bo'lsa (uy, daraxt, tog', boshqa bot) - eng yaqin BO'SH joyni o'zi topadi.
// Yo'l hisoblanmaydi va "to'siq bor" degan xabar chiqmaydi: jangovor bot faqat shu joyda turadi, jang paytida esa
// xaritaning istalgan joyiga uchib boradi (hamma tomonni hisoblab, to'siqlarni chetlab o'tadi).
// bnds: { x0, x1, z0, z1 } (zona chegarasi) yoki null. used: [{ x, z }] - allaqachon band joylar.
// Qaytaradi: { x, z, y (yer balandligi), h (qaysi tomonga qaragan: samolyot uchun eng uzun bo'sh "uchish yo'lagi") }
const PARK = {
  plane: { free: 16, sep: 42, run: 260 },
  heli:  { free: 9,  sep: 22, run: 0 },
};
const TWO_PI = Math.PI * 2;

export function findParkSpot(obs, x, z, kind, used = [], bnds = null) {
  const P = PARK[kind] || PARK.plane;
  const cols = { cols: obs.cols, ramps: [], grid: obs.grid };   // faqat to'siqlar (rampa - bu yer)
  const inB = (px, pz, m) => !bnds || (px > bnds.x0 + m && px < bnds.x1 - m && pz > bnds.z0 + m && pz < bnds.z1 - m);
  const okAt = (px, pz, free, sep) => {
    if (!inB(px, pz, Math.min(free, 12))) return false;
    if (floorAt(cols, px, pz, free) > 0.5) return false;
    for (const u of used) if (Math.hypot(u.x - px, u.z - pz) < sep) return false;
    return true;
  };
  const span = bnds ? Math.max(bnds.x1 - bnds.x0, bnds.z1 - bnds.z0) : 2000;
  const maxR = Math.max(300, Math.min(2500, span));
  const tiers = [[P.free, P.sep], [P.free * 0.5, P.sep * 0.6], [3, 8]];
  const passes = [[0, 250], [1, 250], [0, maxR], [1, maxR], [2, maxR]];   // avval yaqin joy, keyin uzoqroq, oxirida talabni kamaytirib
  let spot = null;
  for (const [ti, rMax] of passes) {
    const [free, sep] = tiers[ti];
    if (okAt(x, z, free, sep)) { spot = { x, z }; break; }
    for (let r = 6; r <= rMax && !spot; r += Math.max(6, r * 0.12)) {
      const n = clamp(Math.ceil((TWO_PI * r) / Math.max(8, sep * 0.5)), 8, 120);
      const a0 = Math.random() * TWO_PI;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k * TWO_PI) / n;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (okAt(px, pz, free, sep)) { spot = { x: px, z: pz }; break; }
      }
    }
    if (spot) break;
  }
  if (!spot) spot = { x, z };   // hech narsa topilmadi: belgilangan joyning o'zi

  const cx0 = bnds ? (bnds.x0 + bnds.x1) / 2 : 0, cz0 = bnds ? (bnds.z0 + bnds.z1) / 2 : 0;
  const toC = Math.atan2(cx0 - spot.x, cz0 - spot.z);
  let h = toC;
  if (kind === 'plane' && P.run) {   // eng uzun to'siqsiz yo'nalish (uchish yo'lagi)
    let best = -1;
    for (let i = 0; i < 16; i++) {
      const hh = (i * TWO_PI) / 16;
      let run = 0;
      for (let d = 20; d <= P.run; d += 20) {
        const px = spot.x + Math.sin(hh) * d, pz = spot.z + Math.cos(hh) * d;
        if (!inB(px, pz, 6) || floorAt(cols, px, pz, 10) > 3) break;
        run = d;
      }
      const score = run + Math.cos(hh - toC) * 8 + Math.random();
      if (score > best) { best = score; h = hh; }
    }
  }
  return { x: r1(spot.x), z: r1(spot.z), y: groundAt(obs, spot.x, spot.z), h };
}

// ---------- Havo floti ----------
// makeModel(kind, modelName?, combat?) -> { root: Object3D, spin: Object3D[], mount?, rockets? }   (kind: 'plane' | 'heli'; modelName - airport.txt dagi nom; har safar YANGI nusxa)
//   combat = true bo'lsa: mount = { size, power, blast, range, tilt, offs: [[x,y,z], ...] } (raketa o'rnatilgan joylar) va rockets = shu joylardagi raketa meshlari (ixtiyoriy)
// fireRocket({ x, y, z, h, pitch, v0, size, power, blast, range }) -> jangovor bot raketa uchirganda chaqiriladi (game.js: rocketSystem.fire)
// obstacles -> { cols, ramps }   (game.js: { cols: colliders, ramps })
// makeVoice(kind) -> { update({ dist, pan, speed }), dispose() } | null   (ixtiyoriy; game.js: remoteAudio.createRemoteVoice)
// hearRange -> { plane: m, heli: m }   (ovoz eshitilish masofasi; undan uzoqda ovoz o'chadi)
// bounds -> { w, e, n, s }   (zona chegarasi; jangovor botlar shu chegaragacha uchib boradi, undan chiqib ketmaydi)
//
// JANGOVOR bot hayoti:  parked (joyida jim turadi) -> alert() -> startup (dvigatel/parrak yurishadi) -> takeoff (uchadi)
//   -> attack (hujum: haqiqiy pilotdek) -> hujum tugagach return (o'z joyiga qaytib) -> qo'nadi -> yana parked.
export function createAirFleet({ scene, makeModel, obstacles, maxBots = 24, makeVoice = null, hearRange = { plane: 430, heli: 300 }, fireRocket = null, bounds = null }) {
  const bots = [];
  const paths = [];
  const parkUsed = [];   // jangovor botlar turgan joylar (bir-biriga yaqin qo'ymaslik uchun)
  const P0 = { x: 0, y: 0, z: 0 }, P1 = { x: 0, y: 0, z: 0 }, P2 = { x: 0, y: 0, z: 0 };
  const tmpRw = { x: 0, z: 0, h: 0 };
  const far2 = AIR_VIEW_DIST * AIR_VIEW_DIST;
  const zb = bounds ? { x0: -bounds.w, x1: bounds.e, z0: -bounds.n, z1: bounds.s } : null;

  function makeGroup(model) {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';   // avval burilish (yaw), keyin burun ko'tarilishi (pitch), keyin yonboshlash (roll)
    group.add(model.root);
    for (const rm of model.rockets || []) group.add(rm);   // jangovor botning raketalari
    group.visible = false;
    scene.add(group);
    return group;
  }

  // Har bir jangovor botning o'z "xarakteri": hammasi bir xil uchmasligi uchun.
  function makePersonality() {
    return {
      react: 0.5 + Math.random() * 0.7,            // reaksiya vaqti (s)
      skill: 0.6 + Math.random() * 0.4,            // mahorat: raketadan qochish ehtimoli va aniqlik
      aimErr: 0.012 + Math.random() * 0.022,       // nishon xatosi (radian)
      lat: (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 90),   // samolyot hujumda yon tomondan egilib keladi (m)
      altBias: -6 + Math.random() * 20,            // sevimli balandlik farqi
      orbitDir: Math.random() < 0.5 ? -1 : 1,     // vertolyot nishon atrofida qaysi tomonga aylanadi
      carrot: 0.3 + Math.random() * 0.25,          // aylanish tezligi
      orbitR: 0.85 + Math.random() * 0.4,          // aylanish radiusi koeffitsiyenti
      ph: Array.from({ length: 6 }, () => Math.random() * 100),
    };
  }

  // Yo'l boshidagi/oxiridagi yo'nalish (bakePath bo'yicha)
  const A1 = { x: 0, y: 0, z: 0 }, A2 = { x: 0, y: 0, z: 0 };
  function headingAt(b, s) {
    sampleBaked(b, s, A1); sampleBaked(b, s + 8, A2);
    return Math.atan2(A2.x - A1.x, A2.z - A1.z);
  }

  function addPath(raw) {
    const path = normalizeAirPath(raw);
    if (path.combat) return addCombat(path);
    if (path.pts.length < 3) return { ok: false, tooShort: true, bots: 0 };
    if (paths.length >= AIR_MAX_PATHS) return { ok: false, tooMany: true, bots: 0 };

    const T = AIR_TYPES[path.type];
    const checked = checkAirPath(path, obstacles, true);   // xavfli joylar avtomatik ko'tariladi
    path.pts = checked.pts;
    const baked = bakePath(path);
    const hasPad = !!path.pad;
    let rw = null;
    if (hasPad && path.type === 'plane') {
      rw = buildRunway(path.runway);
      if (!rw) {   // eski yo'llar: yo'lak chizilmagan - yo'lning boshlanish yo'nalishida 90 m yugurish yo'lagi o'ylab topiladi
        const hh = headingAt(baked, 0);
        rw = buildRunway([[path.pad[0], path.pad[1]], [path.pad[0] + Math.sin(hh) * 90, path.pad[1] + Math.cos(hh) * 90]]);
      }
    }
    // Real profil: pad bor bo'lsa - yerdan sekin ko'tariladi va sekin tushadi. Qo'shimcha botlar (2-, 3-...) esa padga qo'nmaydi:
    // ular pad ustidan ham kruiz balandlikda uchib o'tadi (bir joyga ikkita bot qo'nib qolmasin).
    const count = Math.max(0, Math.min(path.count, maxBots - bots.length));
    const ysFree = hasPad && count > 1 ? makeProfile(baked, path, obstacles, T, 0, false) : null;
    baked.ys = makeProfile(baked, path, obstacles, T, rw ? rw.len : 0, hasPad);
    paths.push(path);

    const cruise = path.speed || T.speed;
    const base = Math.random() * baked.len;
    for (let k = 0; k < count; k++) {
      const model = makeModel(path.type, path.model, false);
      const group = makeGroup(model);
      const cycle = hasPad && k === 0;
      const bk = hasPad && k > 0 ? Object.assign({}, baked, { ys: ysFree }) : baked;
      bots.push(makePatrolBot({ T, path, baked: bk, model, group, cycle, k, count, cruise, base, rw }));
    }
    return { ok: checked.ok, raised: checked.raised, tooHigh: checked.tooHigh, bots: count };
  }

  function makePatrolBot({ T, path, baked, model, group, cycle, k, count, cruise, base, rw }) {
    const bot = {
      T, group, root: model.root, spin: model.spin || [], baked,
      kind: path.type, voice: null, curSpeed: 0, dx: 1e9, dy: 0, dz: 0, vx: 0, vz: 0,
      dents: [], crashCd: 0, hurtUntil: 0,
      combat: false, mount: null, rk: [], mode: 'patrol',
      cruise, cycle, rw, phase: 'fly', s: 0, passedMid: false, waitUntil: 0, rd: 0, gOff: 0,
      px: 0, py: 0, pz: 0, hdg: 0, spd: 0, vy: 0, pitch: 0, bank: 0, hdgRate: 0, hvx: 0, hvz: 0,
      spinK: 0, planAt: 0, needAlt: 0, clr: T.clearance, outUntil: 0, outH: 0, gateAlt: 0, landT: 0, liftT: 0,
      home: null,
    };
    if (cycle) {   // pad bor: yerda turadi, keyin uchadi, aylanib kelib qo'nadi, to'xtaydi va yana uchadi
      const g = groundAt(obstacles, path.pad[0], path.pad[1]);
      const h = rw ? rw.h0 : headingAt(baked, 0);
      bot.home = { x: path.pad[0], z: path.pad[1], y: g + 0.05, h };
      bot.px = path.pad[0]; bot.pz = path.pad[1]; bot.py = g + 0.05; bot.hdg = h;
      bot.phase = 'wait'; bot.mode = 'parked';
      bot.waitUntil = clock + 1.5 + Math.random() * 5;
    } else {       // yo'l bo'ylab doimiy uchadi
      bot.s = (((base + (baked.len * k) / count) % baked.len) + baked.len) % baked.len;
      sampleBaked(baked, bot.s, A1);
      bot.px = A1.x; bot.py = A1.y; bot.pz = A1.z;
      bot.hdg = headingAt(baked, bot.s);
      bot.spd = cruise;
      bot.vx = Math.sin(bot.hdg) * cruise; bot.vz = Math.cos(bot.hdg) * cruise;
      bot.hvx = bot.vx; bot.hvz = bot.vz;
      bot.curSpeed = cruise;
    }
    return bot;
  }

  // Jangovor yozuv: yo'l kerak emas, faqat joy. Bot AI shu atrofdan bo'sh joy topib, jim turadi.
  // Uchish yo'lagi (runway) chizilgan bo'lsa (samolyot) - bot aynan shu chiziqning boshida turadi va shu chiziq bo'ylab uchadi.
  function addCombat(path) {
    const home0 = path.pad ? path.pad : (path.pts.length ? [path.pts[0][0], path.pts[0][1]] : null);
    if (!home0) return { ok: false, tooShort: true, bots: 0 };
    paths.push(path);
    const T = AIR_TYPES[path.type];
    const rwb = path.type === 'plane' ? buildRunway(path.runway) : null;
    const count = Math.max(0, Math.min(path.count, maxBots - bots.length));
    for (let k = 0; k < count; k++) {
      let spot, rd = 0;
      if (rwb) {   // 2-, 3-... botlar yo'lakning boshi orqasida ketma-ket turadi
        rd = -k * 55;
        runwayAt(rwb, rd, tmpRw);
        spot = { x: r1(tmpRw.x), z: r1(tmpRw.z), y: groundAt(obstacles, tmpRw.x, tmpRw.z), h: rwb.h0 };
      } else {
        spot = findParkSpot(obstacles, home0[0], home0[1], path.type, parkUsed, zb);
      }
      parkUsed.push({ x: spot.x, z: spot.z });
      const model = makeModel(path.type, path.model, true);
      const group = makeGroup(model);
      const ps = makePersonality();
      bots.push({
        T, group, root: model.root, spin: model.spin || [], baked: null,
        kind: path.type, voice: null, curSpeed: 0, dx: 1e9, dy: 0, dz: 0, vx: 0, vz: 0, bank: 0,
        dents: [], crashCd: 0, hurtUntil: 0,
        combat: true,
        mount: model.mount || FALLBACK_MOUNT[path.type],
        rk: (model.rockets || []).map((mesh) => ({ mesh, at: 0 })),
        ps,
        home: { x: spot.x, z: spot.z, y: spot.y + 0.05, h: spot.h },
        mode: 'parked',   // 'parked' | 'attack' | 'return'
        sub: '', grounded: true, spinK: 0, final: false,
        px: spot.x, py: spot.y + 0.05, pz: spot.z, hdg: spot.h, spd: 0, vy: 0, hvx: 0, hvz: 0, pitch: 0, hdgRate: 0, clr: 0.05,
        planAt: 0, planOff: 0, planAlt: 0, fireAt: 0, salvoLeft: 0, nextMount: 0, blockedAt: -99,
        breakUntil: 0, breakH: 0, extendUntil: 0, extendDist: 0, lat: ps.lat, altOff: 0, flipAt: 0, startAt: 0, retAt: 0,
        seeAt: 0, seenAt: 0, sx: 0, sy: 0, sz: 0, svx: 0, svy: 0, svz: 0,
        evadeAt: 0, evadeUntil: 0, evadeH: 0, evadeVy: 0,
        rw: rwb, rd, outUntil: 0, outH: 0,
      });
    }
    return { ok: true, raised: 0, tooHigh: false, bots: count, combat: true };
  }

  function killVoice(bot) {
    if (bot.voice) { bot.voice.dispose(); bot.voice = null; }
  }
  // Hamma ovozlarni o'chiradi (pauza, o'yindan chiqish).
  function silence() { for (const bot of bots) killVoice(bot); }

  // Eng yaqin AIR_MAX_VOICES ta botning ovozi: masofa qancha uzoq bo'lsa, shuncha past va xira (remoteAudio.js),
  // chap/o'ng tomonga qarab stereo siljiydi. heading - o'yinchining qarashi (car.h).
  // Joyida turgan jangovor botlar JIM turadi.
  function updateVoices(cx, cy, cz, heading, silent) {
    if (!makeVoice) return;
    const near = [];
    if (!silent) {
      for (const bot of bots) {
        if (bot.mode === 'parked') continue;
        const d = Math.hypot(bot.dx, bot.dy, bot.dz);
        if (d < (hearRange[bot.kind] || 300)) near.push({ bot, d });
      }
      near.sort((a, b) => a.d - b.d);
      near.length = Math.min(near.length, AIR_MAX_VOICES);
    }
    const keep = new Set(near.map((n) => n.bot));
    for (const bot of bots) if (!keep.has(bot)) killVoice(bot);
    const rx = -Math.cos(heading), rz = Math.sin(heading);   // o'yinchining "o'ng" tomoni (game.js dagi bilan bir xil)
    for (const { bot, d } of near) {
      if (!bot.voice) bot.voice = makeVoice(bot.kind);   // audio hali yoqilmagan bo'lsa null - keyingi freymda qayta uriniladi
      if (bot.voice) {
        bot.voice.update({
          dist: d,
          pan: ((bot.dx * rx + bot.dz * rz) / Math.max(d, 1)) * 0.75,
          speed: bot.curSpeed,
        });
      }
    }
  }

  // ---------- JANGOVOR AI ----------
  let clock = 0, hotUntil = 0;
  let pvx = 0, pvy = 0, pvz = 0, pLx = 0, pLy = 0, pLz = 0, pHas = false;   // o'yinchining tezligi (nishonni oldindan hisoblash uchun)
  const _mv = new THREE.Vector3();

  // Silliq "tasodifiy" tebranish (-1..1): pilot qo'li mukammal emas - burilish, balandlik va tezlik biroz suzib turadi.
  const wob = (bot, k) => Math.sin(clock * (0.35 + k * 0.17) + bot.ps.ph[k]) * 0.6 + Math.sin(clock * (0.9 + k * 0.23) + bot.ps.ph[k + 3]) * 0.4;

  // O'yinchi raketa otdi (mashina, samolyot yoki vertolyotdan): joyida turgan jangovor botlar uchib chiqib hujum qiladi.
  // Masofa CHEKLANMAGAN: zona qanchalik katta bo'lmasin, bot chegarasigacha uchib boradi. shot - { x, y, z, h, pitch }: raketa
  // o'z yo'nalishida bot tomon kelayotgan bo'lsa, pilot (reaksiya vaqtidan keyin) raketadan qochadi.
  function alert(hold = AIR_COMBAT_HOLD, shot = null) {
    hotUntil = Math.max(hotUntil, clock + hold);
    let active = 0;
    for (const bot of bots) if (bot.combat && bot.mode === 'attack') active++;
    const list = bots.filter((bt) => bt.combat && (bt.mode === 'parked' || bt.mode === 'return'))
      .sort((a, c) => Math.hypot(a.dx, a.dy, a.dz) - Math.hypot(c.dx, c.dy, c.dz));
    for (const bot of list) {
      if (active >= AIR_COMBAT_MAX) break;
      startAttack(bot);
      active++;
    }
    if (shot) for (const bot of bots) if (bot.combat && bot.mode === 'attack' && !bot.grounded) threat(bot, shot);
    return active;
  }

  function threat(bot, shot) {
    const cp = Math.cos(shot.pitch || 0);
    const fx = Math.sin(shot.h) * cp, fy = -Math.sin(shot.pitch || 0), fz = Math.cos(shot.h) * cp;
    const rx = bot.px - shot.x, ry = bot.py - shot.y, rz = bot.pz - shot.z;
    const t = rx * fx + ry * fy + rz * fz;
    if (t < 40 || t > 1400) return;
    const qx = rx - fx * t, qy = ry - fy * t, qz = rz - fz * t;
    if (Math.hypot(qx, qy, qz) > 90) return;                       // raketa bot tomon kelmayapti
    if (Math.random() > 0.3 + 0.7 * bot.ps.skill) return;           // har pilot ham sezmaydi
    bot.evadeAt = clock + bot.ps.react * 0.7 + 0.15;                // reaksiya vaqti
    bot.evadeUntil = bot.evadeAt + 1.5 + Math.random() * 1.2;
    bot.evadeH = Math.atan2(fx, fz) + (Math.random() < 0.5 ? -1 : 1) * (1.15 + Math.random() * 0.4);   // raketa yo'nalishiga ko'ndalang
    bot.evadeVy = Math.random() < 0.5 ? 1 : -1;
  }

  function startAttack(bot) {
    const ps = bot.ps;
    const wasParked = bot.mode === 'parked';
    bot.mode = 'attack';
    bot.final = false;
    bot.planAt = 0; bot.planOff = 0; bot.salvoLeft = 0; bot.blockedAt = -99; bot.evadeUntil = 0;
    bot.seeAt = 0; bot.lat = ps.lat; bot.flipAt = 0;
    bot.fireAt = clock + 1.2 + Math.random() * 1.5;   // "reaksiya vaqti"
    if (bot.grounded) {
      if (bot.sub === 'rollout') { bot.sub = 'takeoff'; if (bot.rw) bot.rd = rwProject(bot.rw, bot.px, bot.pz); return; }   // qo'nib borayotgan edi: to'xtamasdan qayta uchadi
      bot.sub = 'startup';
      // dvigatel/parrak yurishishi: har bot har xil vaqtda uchadi (hammasi bir vaqtda ko'tarilmasin)
      bot.startAt = clock + (wasParked ? (bot.kind === 'heli' ? 2.4 : 1.6) + ps.react * 1.2 + Math.random() * 1.2 : 0.3);
    } else {
      bot.sub = 'approach';
    }
  }

  // Hujum tugadi: o'z joyiga uchib qaytadi va qo'nadi.
  function startReturn(bot) {
    bot.mode = 'return';
    bot.sub = '';
    bot.final = false;
    bot.retAt = clock;
  }

  function becomePark(bot) {
    bot.mode = 'parked';
    bot.sub = '';
    bot.grounded = true;
    bot.final = false;
    bot.spd = 0; bot.vy = 0; bot.hvx = 0; bot.hvz = 0; bot.vx = 0; bot.vz = 0; bot.hdgRate = 0;
    bot.home = { x: bot.px, z: bot.pz, y: bot.py, h: bot.hdg };   // qaerga qo'nsa, keyingi safar shu joydan uchadi
  }

  function liftOff(bot) {
    bot.grounded = false;
    bot.sub = 'approach';
    bot.clr = clamp(bot.py - floorAt(obstacles, bot.px, bot.pz, 2), 0.3, bot.T.clearance);
    bot.seeAt = 0; bot.planAt = 0;
    bot.fireAt = Math.max(bot.fireAt, clock + 1.2 + Math.random() * 1.5);
  }

  // Raketa yo'lida to'siq (tog', bino, daraxt, yer) bormi? false = to'siq bor, otib bo'lmaydi.
  function clearShot(x, y, z, tx, ty, tz) {
    const len = Math.hypot(tx - x, ty - y, tz - z);
    const n = Math.min(40, Math.ceil(len / 30));
    for (let i = 1; i < n; i++) {
      const t = (i / n) * 0.92;
      if (floorAt(obstacles, x + (tx - x) * t, z + (tz - z) * t, 1) > y + (ty - y) * t - 0.5) return false;
    }
    return true;
  }

  // To'siqlardan qochish: nishon yo'nalishidan har xil og'ishlarni sinaydi. Har biri uchun oldindagi to'siqlarni tekshiradi:
  // past to'siq bo'lsa - ustidan ko'tariladi, juda baland bo'lsa - yonidan aylanib o'tadi (eng arzon variant tanlanadi).
  // Bot uchun yo'l oldindan belgilanmagan: istalgan joyga borishda shu hisob-kitob bilan yo'l topadi.
  function planFlight(bot, desH, desAlt) {
    const T = bot.T, A = T.atk;
    const spd = Math.max(bot.spd, A.speed * 0.5, 8);
    const look = Math.max(A.look, spd * 3);
    const N = 6;
    let best = null;
    for (const off of AVOID_OFFS) {
      const sx = Math.sin(desH + off), sz = Math.cos(desH + off);
      let need = 0, infeasible = 0;
      for (let k = 1; k <= N; k++) {
        const d = (look * k) / N;
        const nd = floorAt(obstacles, bot.px + sx * d, bot.pz + sz * d, T.margin + 4) + T.clearance + 3;
        const reach = bot.py + A.climb * 0.75 * (d / spd);   // shu masofagacha ko'tarila oladigan balandlik
        if (nd > reach) infeasible += nd - reach;
        if (nd > need) need = nd;
      }
      let alt = Math.max(desAlt, need);
      let cost = Math.abs(off) + Math.abs(off - bot.planOff) * 0.15
        + Math.max(0, alt - Math.max(desAlt, bot.py)) * 0.012 + infeasible * 0.25;
      if (alt > T.maxAlt) { cost += (alt - T.maxAlt) * 0.2; alt = T.maxAlt; }
      if (!best || cost < best.cost) best = { cost, off, alt };
    }
    bot.planOff = best.off;
    bot.planAlt = best.alt;
  }

  // Zona chegarasiga yaqinlashganda (uzoqlashib ketayotganda) markazga qarab buriladi.
  function edgeSteer(bot, h) {
    if (!zb) return h;
    const m = 50 + bot.spd * 1.6;
    const fx = Math.sin(h), fz = Math.cos(h);
    const dL = bot.px - zb.x0, dR = zb.x1 - bot.px, dN = bot.pz - zb.z0, dS = zb.z1 - bot.pz;
    const out = (dR < m && fx > 0.05) || (dL < m && fx < -0.05) || (dS < m && fz > 0.05) || (dN < m && fz < -0.05);
    if (!out) return h;
    const k = clamp(1.2 - Math.min(dL, dR, dN, dS) / m, 0, 1);
    const toC = Math.atan2((zb.x0 + zb.x1) / 2 - bot.px, (zb.z0 + zb.z1) / 2 - bot.pz);
    return h + wrapAngle(toC - h) * k;
  }

  // Nishonga qaragan bo'lsa va yo'lida to'siq bo'lmasa raketa uchiradi (2 tadan, navbat bilan chap/o'ng).
  // Nishon xatosi har pilotda har xil va nishon tez harakat qilsa kattalashadi (100% aniq emas).
  function tryFire(bot, lx, ly, lz, dist) {
    const A = bot.T.atk, mt = bot.mount;
    if (!fireRocket || !mt || clock < bot.fireAt || clock < bot.hurtUntil) return;
    if (dist > A.fireRange || dist < 45) return;
    if (Math.abs(wrapAngle(Math.atan2(lx - bot.px, lz - bot.pz) - bot.hdg)) > A.cone) return;   // burni nishonga qaramasa otmaydi
    if (bot.py - floorAt(obstacles, bot.px, bot.pz, 3) < 6) return;                              // yerga juda yaqin - otmaydi
    if (!clearShot(bot.px, bot.py, bot.pz, lx, ly, lz)) { bot.blockedAt = clock; bot.fireAt = clock + 0.4; return; }

    const i = bot.nextMount++ % mt.offs.length, o = mt.offs[i];
    bot.group.position.set(bot.px, bot.py, bot.pz);
    bot.group.rotation.set(bot.pitch, bot.hdg, bot.bank);
    bot.group.updateMatrixWorld(true);
    _mv.set(o[0], o[1], o[2]);
    bot.group.localToWorld(_mv);
    const ddx = lx - _mv.x, ddy = ly - _mv.y, ddz = lz - _mv.z;
    const len = Math.hypot(ddx, ddy, ddz) || 1;
    const err = bot.ps.aimErr * (1 + Math.min(1, Math.hypot(pvx, pvz) / 60));
    const hh = Math.atan2(ddx, ddz) + (Math.random() - 0.5) * 2 * err;
    fireRocket({
      x: _mv.x, y: _mv.y, z: _mv.z,
      h: hh,
      pitch: -Math.asin(clamp(ddy / len, -1, 1)) + (Math.random() - 0.5) * 2 * err,
      v0: Math.max(0, bot.vx * Math.sin(hh) + bot.vz * Math.cos(hh)),
      size: mt.size, power: mt.power, blast: mt.blast, range: mt.range > 0 ? Math.max(mt.range, dist + 80) : 0,
    });
    const rk = bot.rk[i];
    if (rk) { rk.mesh.visible = false; rk.at = clock + A.cooldown; }
    if (bot.salvoLeft > 0) bot.salvoLeft--; else bot.salvoLeft = A.salvo - 1;
    bot.fireAt = clock + (bot.salvoLeft > 0 ? 0.3 + Math.random() * 0.15 : A.cooldown * (0.85 + Math.random() * 0.5));
  }

  // Yerdagi bosqichlar: dvigatel yurishishi (startup), uchish yugurishi (takeoff), qo'nib to'xtash (rollout).
  function groundStep(bot, dt) {
    const T = bot.T, A = T.atk;
    const plane = bot.kind === 'plane';
    const g = groundAt(obstacles, bot.px, bot.pz);
    if (bot.sub === 'startup') {
      bot.py = g + 0.05;
      if (clock >= bot.startAt) {
        bot.sub = 'takeoff';
        if (bot.rw) bot.rd = rwProject(bot.rw, bot.px, bot.pz);   // yo'lakning qaysi joyida turgan bo'lsa, o'sha joydan yuguradi
      }
      return;
    }
    if (bot.sub === 'rollout') {   // qo'ngandan keyin sekin to'xtaydi
      bot.spd = Math.max(0, bot.spd - (plane ? 6 : 16) * dt);   // samolyot sekin to'xtaydi
      bot.px += Math.sin(bot.hdg) * bot.spd * dt;
      bot.pz += Math.cos(bot.hdg) * bot.spd * dt;
      bot.py = groundAt(obstacles, bot.px, bot.pz) + 0.05;
      bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
      bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 4);
      bot.bank += (0 - bot.bank) * Math.min(1, dt * 4);
      if (bot.spd < 0.5) becomePark(bot);
      return;
    }
    // takeoff
    if (plane && bot.rw) {   // UCHISH YO'LAGI: chiziq bo'ylab yuguradi, chiziq tugaganda sekin havoga ko'tariladi
      const rw = bot.rw, vr = A.speed * 0.5;
      const left = Math.max(12, rw.len - bot.rd);
      bot.spd += clamp((vr * vr - bot.spd * bot.spd) / (2 * left), 1.5, A.accel * 0.9) * dt;   // tezlik aynan chiziq oxirida yetadigan qilib tezlanadi
      bot.spd = Math.min(bot.spd, vr * 1.3);
      bot.rd += bot.spd * dt;
      runwayAt(rw, bot.rd, tmpRw);
      bot.px = tmpRw.x; bot.pz = tmpRw.z;
      bot.hdg += wrapAngle(tmpRw.h - bot.hdg) * Math.min(1, dt * 3);
      bot.py = groundAt(obstacles, bot.px, bot.pz) + 0.05;
      bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
      const rot = bot.rd >= rw.len - 8 && bot.spd >= vr * 0.9;   // chiziq oxiriga yaqinlashganda burnini sekin ko'taradi
      bot.pitch += ((rot ? -0.13 : 0) - bot.pitch) * Math.min(1, dt * 1.6);
      if (bot.rd >= rw.len && bot.spd >= vr) {
        bot.vy = 0.6; bot.outH = bot.hdg; bot.outUntil = clock + 11;   // havoga sekin ko'tariladi va o'z yo'nalishida to'g'ri uchadi
        liftOff(bot);
      }
      return;
    }
    if (plane) {   // yerda tezlanadi, tezlik yetgach burnini ko'taradi va uzilib chiqadi
      const vr = A.speed * 0.5;
      bot.spd += A.accel * 0.55 * dt;
      bot.px += Math.sin(bot.hdg) * bot.spd * dt;
      bot.pz += Math.cos(bot.hdg) * bot.spd * dt;
      bot.py = groundAt(obstacles, bot.px, bot.pz) + 0.05;
      bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
      bot.pitch += ((bot.spd > vr * 0.85 ? -0.16 : 0) - bot.pitch) * Math.min(1, dt * 3);
      if (bot.spd >= vr) { bot.vy = 1; liftOff(bot); }
    } else {       // vertolyot: tik ko'tariladi
      bot.vy = Math.min(5, bot.vy + 3 * dt);
      bot.py += bot.vy * dt;
      bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 3);
      if (bot.py - g > 5) liftOff(bot);
    }
  }

  // Havodagi bosqichlar: hujum (attack) va qaytish (return). Haqiqiy pilotdek:
  //  - nishonni doim ham mukammal ko'rmaydi (0.2-0.45 s da bir yangilanadi, oraliqda taxmin qiladi);
  //  - burilish birdan emas, silliq tezlanib-sekinlashadi; yonboshlash burilishga ergashadi;
  //  - samolyot nishonga to'g'ri chiziqda emas, yon tomondan egilib keladi, o'tib ketgach burilib qayta hujum qiladi;
  //  - vertolyot nishon atrofida aylanib, yonga siljib turadi (burni nishonda), tezlanganda burnini egadi;
  //  - balandlik, tezlik va yo'nalish biroz tebranib turadi; raketadan qochadi.
  function flightStep(bot, dt, cx, cy, cz, silent) {
    const T = bot.T, A = T.atk, ps = bot.ps;
    const plane = bot.kind === 'plane';
    const hm = clock < bot.hurtUntil ? 3 : 1;   // urilgan bot boshqaruvni yomon ushlaydi

    // pilotning ko'rishi
    if (clock >= bot.seeAt) {
      bot.seeAt = clock + 0.2 + Math.random() * 0.25;
      bot.sx = cx; bot.sy = cy + 1.5; bot.sz = cz; bot.svx = pvx; bot.svy = pvy; bot.svz = pvz; bot.seenAt = clock;
    }
    const age = Math.min(clock - bot.seenAt, 0.6);
    const tx = bot.sx + bot.svx * age, ty = bot.sy + bot.svy * age, tz = bot.sz + bot.svz * age;
    const dx = tx - bot.px, dy = ty - bot.py, dz = tz - bot.pz;
    const hd = Math.hypot(dx, dz);
    const dist = Math.hypot(hd, dy);

    let desH = bot.hdg, desAlt = bot.py, spdT = A.speed;
    let hv = null, yawT = null;       // vertolyot: kerakli tezlik vektori { h, m } va burun yo'nalishi
    let lx = tx, ly = ty, lz = tz;
    let landing = false, dH = 0;
    const evading = bot.mode === 'attack' && clock >= bot.evadeAt && clock < bot.evadeUntil;
    const gNow = groundAt(obstacles, bot.px, bot.pz);
    // yo'lakdan ko'tarilgandan keyin: biroz vaqt o'z yo'nalishida, sekin ko'tarilib uchadi
    const climbOut = plane && bot.mode === 'attack' && clock < bot.outUntil && bot.py - gNow < 70;

    if (bot.mode === 'attack') {
      // Oldindan nishon: raketa yetib borguncha o'yinchi qayerga uchib borishini hisoblaydi
      const tl = clamp(dist / (ROCKET_SPEED * bot.mount.power + bot.spd), 0, 3);
      lx = tx + bot.svx * tl; ly = ty + bot.svy * tl; lz = tz + bot.svz * tl;
      const brg = Math.atan2(lx - bot.px, lz - bot.pz);
      desH = brg;
      desAlt = (dist > A.fireRange ? Math.max(T.defAlt + 30, ty + 25) : ty + clamp(dist * 0.1, 8, 45))
        + ps.altBias * 0.5 + wob(bot, 1) * 4 * hm;
      if (plane) {
        const closing = dx * Math.sin(bot.hdg) + dz * Math.cos(bot.hdg) > 0;
        if (bot.sub === 'approach' && dist < A.minDist && closing) {   // o'tib ketdi: yon tomonga burilib, ko'tarilib, qayta hujum qiladi
          bot.sub = 'break';
          bot.breakUntil = clock + A.breakTime * (0.8 + Math.random() * 0.5);
          bot.breakH = bot.hdg + (Math.random() < 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.6);
          bot.lat = -bot.lat * (0.6 + Math.random() * 0.8);            // keyingi hujum boshqa tomondan
        }
        if (bot.sub === 'break') {
          if (clock >= bot.breakUntil) {   // burilish tugadi: to'g'ri uchib uzoqlashadi (energiya yig'adi), keyin qayta hujum
            bot.sub = 'extend';
            bot.breakH = bot.hdg;
            bot.extendUntil = clock + 12;
            bot.extendDist = 380 + Math.random() * 220;
          } else { desH = edgeSteer(bot, bot.breakH); desAlt = Math.max(desAlt, bot.py + 25); }
        }
        if (bot.sub === 'extend') {
          if (clock >= bot.extendUntil || dist > bot.extendDist) bot.sub = 'approach';
          else { desH = edgeSteer(bot, bot.breakH); desAlt = Math.max(desAlt, bot.py); }
        }
        if (bot.sub === 'approach') {
          const off = bot.lat * clamp((hd - 260) / 650, 0, 1);         // uzoqda yon tomondan, yaqinlashgan sari to'g'rilanadi
          desH = Math.atan2(lx + Math.cos(brg) * off - bot.px, lz - Math.sin(brg) * off - bot.pz);
        }
        const load = clamp(Math.abs(bot.hdgRate) / A.turn, 0, 1);
        spdT = A.speed * (1 + 0.05 * wob(bot, 2)) * (1 - 0.2 * load);   // qattiq burilganda tezlik biroz tushadi
      } else {
        const R = A.standoff * ps.orbitR;
        if (clock >= bot.flipAt) {   // vaqti-vaqti bilan aylanish yo'nalishi va balandligini o'zgartiradi
          bot.flipAt = clock + 5 + Math.random() * 9;
          if (Math.random() < 0.4) ps.orbitDir = -ps.orbitDir;
          bot.altOff = -8 + Math.random() * 22;
        }
        desAlt += bot.altOff;
        let vdx, vdz, vm;
        if (hd > R * 1.8) { vdx = dx; vdz = dz; vm = A.speed; }                 // uzoqda: to'g'ri nishonga
        else {                                                                  // yaqinda: nishon atrofida aylanadi
          const a = Math.atan2(bot.px - tx, bot.pz - tz) + ps.orbitDir * ps.carrot;
          vdx = tx + Math.sin(a) * R - bot.px; vdz = tz + Math.cos(a) * R - bot.pz;
          vm = clamp(Math.hypot(vdx, vdz) * 0.45, 0, A.speed * 0.75);
        }
        hv = { h: Math.atan2(vdx, vdz), m: vm };
        yawT = hd > A.fireRange * 1.2 ? hv.h : Math.atan2(dx, dz);              // burni nishonga qaraydi
      }
      if (climbOut) { desH = bot.outH; desAlt = Math.max(desAlt, bot.py + 20); }   // yo'lakdan chiqqach to'g'ri va sekin ko'tariladi
      if (clock - bot.blockedAt < 1.5) desAlt += 45;                            // yo'lda tog'/bino bor edi: balandroq ko'tariladi
      if (evading) {                                                            // raketadan qochish
        const eh = edgeSteer(bot, bot.evadeH);
        desH = eh;
        desAlt = clamp(bot.py + bot.evadeVy * 35, T.minAlt, T.maxAlt);
        spdT = A.speed * 1.1;
        if (!plane) hv = { h: eh, m: A.speed };
      }
    } else {
      // QAYTISH: o'z joyiga uchib boradi, samolyot uchish yo'lagi bo'ylab yaqinlashadi, keyin pastlab qo'nadi
      const hx = bot.home.x, hz = bot.home.z;
      dH = Math.hypot(hx - bot.px, hz - bot.pz);
      let ax = hx, az = hz;
      if (plane && !bot.final) {
        const fx = hx - Math.sin(bot.home.h) * 420, fz = hz - Math.cos(bot.home.h) * 420;   // uzun, yumshoq qo'nish yo'li
        if (Math.hypot(fx - bot.px, fz - bot.pz) < 110 || dH < 450) bot.final = true;
        else { ax = fx; az = fz; }
      }
      const adx = ax - bot.px, adz = az - bot.pz;
      desH = Math.atan2(adx, adz);
      if (plane) {
        landing = dH < 560;
        desAlt = landing ? bot.home.y + clamp(dH * 0.085, 0, 80) : Math.max(T.minAlt + 10, T.defAlt * 0.8);   // ~5° nishab: burun bilan "sho'ng'imaydi"
        spdT = clamp(dH * 0.12 + 17, 18, A.speed * 0.9);
      } else {
        landing = dH < 160;
        desAlt = landing ? bot.home.y + clamp((dH - 8) * 0.4, 0, 60) : Math.max(T.minAlt + 8, T.defAlt);
        hv = { h: desH, m: clamp((Math.hypot(adx, adz) - 3) * 0.5, 0, A.speed) };
        yawT = dH < 60 ? bot.home.h : hv.h;
      }
      if (clock - bot.retAt > 100) {   // juda cho'zilib ketsa: to'g'ridan-to'g'ri joyiga qo'yamiz
        bot.px = bot.home.x; bot.pz = bot.home.z; bot.py = bot.home.y; bot.hdg = bot.home.h;
        becomePark(bot);
        return;
      }
    }

    desAlt = landing ? Math.min(Math.max(desAlt, bot.home.y), T.maxAlt) : clamp(desAlt, T.minAlt, T.maxAlt);

    // Yo'lni rejalash (qo'nish oldidan to'siq tekshirilmaydi - qo'nish joyi bo'sh joy sifatida tanlangan)
    if (landing && dH < 150) { bot.planOff = 0; bot.planAlt = desAlt; }
    else if (clock >= bot.planAt) {
      bot.planAt = clock + 0.12 + Math.random() * 0.06;
      planFlight(bot, plane ? desH : (hv ? hv.h : desH), desAlt);
    }

    // burilish: silliq (burchak tezlanishi cheklangan), kichik tebranish bilan
    const wantH = plane
      ? desH + bot.planOff + (bot.mode === 'attack' ? wob(bot, 0) * 0.025 * hm : 0)
      : (yawT !== null ? yawT : bot.hdg);
    const err = wrapAngle(wantH - bot.hdg);
    const rateT = clamp(err * 2.4, -A.turn, A.turn);
    const accR = A.turn * 2.4 * dt;
    bot.hdgRate += clamp(rateT - bot.hdgRate, -accR, accR);
    bot.hdg = wrapAngle(bot.hdg + bot.hdgRate * dt);

    // tezlik va harakat
    if (plane) {
      bot.spd += clamp(spdT - bot.spd, -A.accel * dt, A.accel * dt);
      bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
    } else {
      const vh = hv ? hv.h + bot.planOff : bot.hdg;
      const vm = hv ? hv.m : 0;
      let ex = Math.sin(vh) * vm - bot.hvx, ez = Math.cos(vh) * vm - bot.hvz;
      const el = Math.hypot(ex, ez), mx = A.accel * 0.7 * dt;
      if (el > mx) { ex *= mx / el; ez *= mx / el; }
      bot.hvx += ex; bot.hvz += ez;
      bot.spd = Math.hypot(bot.hvx, bot.hvz);
      bot.vx = bot.hvx; bot.vz = bot.hvz;
    }
    bot.px += bot.vx * dt;
    bot.pz += bot.vz * dt;

    // balandlik
    const gHere = groundAt(obstacles, bot.px, bot.pz);
    const climbCap = climbOut ? Math.max(3, bot.spd * 0.11) : A.climb;
    let vyT = clamp((bot.planAlt - bot.py) * 1.2, -A.sink, climbCap);
    if (plane && vyT > 0) vyT *= clamp((bot.spd - A.speed * 0.35) / (A.speed * 0.2), 0.1, 1);   // tezlik kam bo'lsa ko'tarila olmaydi
    if (landing) vyT = Math.max(vyT, plane ? -(0.5 + (bot.py - gHere) * 0.14) : -(1.2 + (bot.py - gHere) * 0.35));   // yerga yaqinlashganda sekin tushadi
    const dv = (climbOut ? 1.4 : A.climb * 1.5) * dt;
    bot.vy += clamp(vyT - bot.vy, -dv, dv);
    bot.py += bot.vy * dt;

    // zona chegarasidan chiqib ketmaydi (lekin chegaragacha uchib boradi)
    if (zb) { bot.px = clamp(bot.px, zb.x0 + 3, zb.x1 - 3); bot.pz = clamp(bot.pz, zb.z0 + 3, zb.z1 - 3); }

    // oxirgi himoya: hech qachon to'siq/yer ichiga kirmaydi (past balandlikdan boshlasa, zaxira asta-sekin kattalashadi)
    bot.clr = landing ? clamp(0.05 + dH * (plane ? 0.05 : 0.12), 0.05, T.clearance) : Math.min(T.clearance, bot.clr + dt * 3);
    const minY = floorAt(obstacles, bot.px, bot.pz, landing ? 1 : 2) + bot.clr;
    if (bot.py < minY) { bot.py = minY; if (bot.vy < 0) bot.vy = 0; }

    // qo'nish
    if (bot.mode === 'return' && landing) {
      const gh = groundAt(obstacles, bot.px, bot.pz);
      if (plane && dH < 60 && bot.py - gh <= bot.clr + 0.4 && bot.py - gh < 1.2) {
        bot.grounded = true; bot.sub = 'rollout'; bot.vy = 0; bot.py = gh + 0.05;
        return;
      }
      if (!plane && dH < 4 && bot.py - gh <= bot.clr + 0.2) {
        bot.px = bot.home.x; bot.pz = bot.home.z; bot.py = bot.home.y;
        becomePark(bot);
        return;
      }
    }

    if (bot.mode === 'attack' && !silent && !evading) tryFire(bot, lx, ly, lz, dist);

    // ko'rinish: burun, yonboshlash
    if (plane) {
      let pT = clamp(-Math.atan2(bot.vy, Math.max(bot.spd, 10)), -0.6, 0.1);   // burun tushishi 6° dan oshmaydi
      if (landing && bot.py - gHere < 14) pT = Math.min(pT, -0.05);              // qo'nish oldidan burun biroz ko'tariladi (flare)
      bot.pitch += (pT - bot.pitch) * Math.min(1, dt * 3);
      const bankT = -clamp(Math.atan((bot.spd * bot.hdgRate) / 9.81), -T.maxBank * 1.3, T.maxBank * 1.3);
      bot.bank += (bankT - bot.bank) * Math.min(1, dt * 2.5);
    } else {
      const fwd = bot.hvx * Math.sin(bot.hdg) + bot.hvz * Math.cos(bot.hdg);
      const side = bot.hvx * Math.cos(bot.hdg) - bot.hvz * Math.sin(bot.hdg);   // chap tomonga siljish musbat
      const pT = clamp((fwd / A.speed) * 0.28, -0.22, 0.32);
      const bT = -clamp((side / A.speed) * 0.5 + bot.hdgRate * 0.08, -T.maxBank * 1.4, T.maxBank * 1.4);
      bot.pitch += (pT - bot.pitch) * Math.min(1, dt * 3);
      bot.bank += (bT - bot.bank) * Math.min(1, dt * 2.2);
    }
  }

  // Jangovor botning bir freymi: holat + ko'rinish.
  function stepCombat(bot, dt, cx, cy, cz, silent) {
    const T = bot.T;
    dt = Math.min(dt, 0.1);
    if (dt > 0 && bot.mode !== 'parked') {
      if (bot.mode === 'attack' && clock > hotUntil) {
        if (bot.grounded) {                                  // hali uchmagan: bekor qiladi
          if (bot.spd > 2) { bot.mode = 'return'; bot.sub = 'rollout'; }
          else becomePark(bot);
        } else startReturn(bot);
      }
      if (bot.mode !== 'parked') {
        if (bot.grounded) groundStep(bot, dt);
        else flightStep(bot, dt, cx, cy, cz, silent);
      }
    }
    // parrak/propeller: yurgizilganda aylanadi, joyida turganda to'xtaydi
    bot.spinK += clamp((bot.mode === 'parked' ? 0 : 1) - bot.spinK, -dt * 0.3, dt * 0.45);
    bot.curSpeed = bot.mode === 'parked' ? 0 : bot.spd;
    bot.dx = bot.px - cx; bot.dy = bot.py - cy; bot.dz = bot.pz - cz;
    if (bot.dx * bot.dx + bot.dy * bot.dy + bot.dz * bot.dz > far2) {
      if (bot.group.visible) bot.group.visible = false;
      return;
    }
    bot.group.visible = true;
    bot.group.position.set(bot.px, bot.py, bot.pz);
    bot.group.rotation.set(bot.pitch, bot.hdg, bot.bank);
    const rate = T.spin * dt * bot.spinK;
    if (rate > 0) for (const sp of bot.spin) sp.rotation.y += rate;
  }

  // O'yinchi bot bilan to'qnashdi (game.js chaqiradi): bot biroz tezligini yo'qotadi, boshqaruv buziladi, bir muddat otmaydi.
  // (nx, nz) - o'yinchidan bot tomonga yo'nalish.
  function bump(bot, nx, nz, closing) {
    bot.hurtUntil = clock + 3.5;
    if (!bot.combat || bot.mode === 'parked') return;
    bot.spd *= 0.75; bot.hvx *= 0.75; bot.hvz *= 0.75;
    bot.hdgRate += (Math.random() - 0.5) * 1.2;
    bot.vy -= 6;
    if (!bot.grounded) { bot.px += nx * 1.5; bot.pz += nz * 1.5; }
  }

  // ---------- ODDIY BOTLAR (jangovor emas): odamdek uchadi ----------
  // Yo'l faqat yo'nalish beradi. Bot "pilot" kabi: oldinga qarab (pure pursuit) buriladi, burilish tezligi yonboshlash burchagi bilan
  // cheklangan (katta samolyot keskin burilmaydi), balandlikni sekin o'zgartiradi, oldidagi to'siq (uy, tog') ustidan ko'tarilib o'tadi.
  // Pad bor bo'lsa: wait (turadi) -> roll (yuguradi) -> fly (uchadi) -> gate -> final (qo'nish yo'liga chiqadi) -> rollout (sekin to'xtaydi) -> wait.
  // Vertolyot: wait -> lift (tik ko'tariladi) -> fly -> land (padga yaqinlashib tik tushadi) -> wait.
  const G = 9.81;
  const waitTime = (F) => F.wait[0] + Math.random() * (F.wait[1] - F.wait[0]);

  // Oldindagi to'siqlar uchun kerakli minimal balandlik (padning yonida zaxira kamayadi: qo'nish/uchish mumkin bo'lsin)
  function aheadNeed(bot, h, dist) {
    const T = bot.T, hx = Math.sin(h), hz = Math.cos(h), pad = bot.home;
    let need = 0;
    for (let k = 1; k <= 5; k++) {
      const d = (dist * k) / 5;
      const x = bot.px + hx * d, z = bot.pz + hz * d;
      let margin = T.margin, clr = T.clearance;
      if (pad) {
        const t = clamp(Math.hypot(x - pad.x, z - pad.z) / T.padR, 0, 1);
        margin = 2 + (T.margin - 2) * t;
        clr = 0.5 + (T.clearance - 0.5) * t;
      }
      const n = floorAt(obstacles, x, z, margin) + clr;
      if (n > need) need = n;
    }
    return need;
  }

  // Samolyot yerda: yo'lak bo'ylab yuguradi (roll) yoki qo'ngandan keyin sekin to'xtaydi (rollout)
  function planeGround(bot, dt, vr) {
    const T = bot.T, F = T.fly, rw = bot.rw;
    if (bot.phase === 'roll') {
      const left = Math.max(12, rw.len - bot.rd);   // tezlik aynan yo'lak oxirida yetadigan qilib tezlanadi
      bot.spd += clamp((vr * vr - bot.spd * bot.spd) / (2 * left), 1.6, 7) * dt;
      bot.spd = Math.min(bot.spd, vr * 1.25);
    } else {
      bot.spd = Math.max(0, bot.spd - (bot.spd > 12 ? F.brake * 0.55 : F.brake) * dt);   // avval yengil, keyin kuchliroq tormoz
    }
    bot.rd += bot.spd * dt;
    runwayAt(rw, bot.rd, tmpRw);
    bot.gOff *= Math.exp(-dt * 0.7);   // qo'nganda yo'lakdan chetroqqa tushgan bo'lsa, asta-sekin chiziqqa o'tadi
    bot.px = tmpRw.x + Math.cos(tmpRw.h) * bot.gOff;
    bot.pz = tmpRw.z - Math.sin(tmpRw.h) * bot.gOff;
    bot.hdg = wrapAngle(bot.hdg + wrapAngle(tmpRw.h - bot.hdg) * Math.min(1, dt * 3));
    bot.py = groundAt(obstacles, bot.px, bot.pz) + 0.05;
    bot.vy = 0; bot.hdgRate = 0;
    bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
    bot.bank += (0 - bot.bank) * Math.min(1, dt * 3);
    if (bot.phase === 'roll') {
      // yo'lak oxiriga yaqinlashganda burnini SEKIN ko'taradi; chiziq tugaganda va tezlik yetganda havoga ko'tariladi
      const rot = bot.rd >= rw.len - 10 && bot.spd >= vr * 0.92;
      bot.pitch += ((rot ? -F.rotate : 0) - bot.pitch) * Math.min(1, dt * 1.6);
      if (bot.rd >= rw.len && bot.spd >= vr) {
        bot.phase = 'fly';
        bot.vy = 0.5;
        bot.outH = bot.hdg; bot.outUntil = clock + F.outT;   // biroz vaqt o'z yo'nalishida to'g'ri uchadi
        bot.liftT = clock;
        bot.s = nearestS(bot.baked, bot.px, bot.pz, 0, 0, Math.min(bot.baked.len, 900)).s;
        bot.passedMid = false;
        bot.clr = clamp(bot.py - floorAt(obstacles, bot.px, bot.pz, 2), 0.3, T.clearance);
        bot.planAt = 0;
      }
    } else {
      bot.pitch += ((bot.spd > 6 ? -0.03 : 0) - bot.pitch) * Math.min(1, dt * 1.5);
      if (bot.spd < 0.35) {
        bot.spd = 0; bot.vx = 0; bot.vz = 0;
        bot.phase = 'wait'; bot.waitUntil = clock + waitTime(F);
      }
    }
  }

  // Samolyot havoda: yo'l bo'ylab (fly) yoki qo'nish yo'lagiga (gate, final)
  function planeFly(bot, dt, vr) {
    const T = bot.T, F = T.fly, b = bot.baked, rw = bot.rw;
    const gH = groundAt(obstacles, bot.px, bot.pz);
    const landing = bot.phase === 'gate' || bot.phase === 'final';
    let desH = bot.hdg, altT = bot.py, along = 0, cross = 0, dLand = 0;

    if (!landing) {
      // uchish-qo'nish sikli bor botda yo'l boshiga qaytib o'tib ketmaydi (aylanma izlash yo'q), faqat oldinga siljiydi
      let n = nearestS(b, bot.px, bot.pz, bot.s, bot.cycle ? Math.min(60, bot.s) : 60, bot.cycle ? Math.min(280, Math.max(40, b.len - bot.s)) : 280);
      if (n.d > 900) { n = nearestS(b, bot.px, bot.pz, 0, 0, b.len); bot.s = n.s; }   // yo'ldan juda uzoqlashib ketgan bo'lsa, qayta topadi
      else bot.s = advanceS(bot.s, n.s, b.len, Math.max(bot.spd, 8) * dt * 2.2);   // yo'l bo'ylab faqat sekin siljiydi (burchakni kesib o'tib ketmaydi)
      if (bot.s > b.len * 0.5) bot.passedMid = true;
      const Ld = clamp(bot.spd * F.lookT, 90, 300);
      sampleBaked(b, bot.s + Ld, A1);
      desH = Math.atan2(A1.x - bot.px, A1.z - bot.pz);
      sampleBaked(b, bot.s + clamp(bot.spd * 3, 60, 220), A2);
      altT = A2.y;
      if (clock >= bot.planAt) {   // oldindagi to'siqlarni tekshirish (har 0.2 s)
        bot.planAt = clock + 0.2 + Math.random() * 0.06;
        bot.needAlt = aheadNeed(bot, bot.hdg, Math.max(260, bot.spd * 7));
      }
      altT = Math.max(altT, bot.needAlt);
      if (clock < bot.outUntil && bot.py - gH < 60) desH = bot.outH;   // yo'lakdan ko'tarilgach o'z yo'nalishida to'g'ri uchadi
      if (bot.cycle && bot.passedMid && clock - bot.liftT > b.len / (bot.cruise * 1.6) && bot.s >= b.len - clamp(b.len * 0.42, 600, F.gate + 500)) {   // qo'nish vaqti
        bot.phase = 'gate'; bot.gateAlt = Math.max(60, bot.py - bot.home.y); bot.landT = clock;
      }
    }
    if (bot.phase === 'gate' || bot.phase === 'final') {
      const O = rw.pts[0], ux = Math.sin(rw.h0), uz = Math.cos(rw.h0);
      const dx = bot.px - O[0], dz = bot.pz - O[1];
      along = dx * ux + dz * uz;        // yo'lak boshidan oldinga masofa (manfiy = yo'lak oldida)
      cross = dx * uz - dz * ux;        // o'ng tomonga og'ish
      dLand = Math.hypot(dx, dz);
      const gy0 = bot.home.y, Td = Math.min(25, rw.len * 0.4);
      if (bot.phase === 'gate') {       // yo'lak oldidagi "darvoza" nuqtasiga uchib boradi (tekis, uzun qo'nish yo'li)
        const gx = O[0] - ux * (F.gate + 700), gz = O[1] - uz * (F.gate + 700);   // uzoqroq nuqta: burilib olishga joy bor
        const dG = Math.hypot(gx - bot.px, gz - bot.pz);
        desH = Math.atan2(gx - bot.px, gz - bot.pz);
        altT = gy0 + clamp(F.glide * dLand, 60, bot.gateAlt);
        const aligned = Math.abs(wrapAngle(rw.h0 - bot.hdg)) < 0.6 && Math.abs(cross) < 160 && along < -250
          && bot.py - gy0 < F.glide * (Td - along) + 25;
        if (aligned || dG < 260) bot.phase = 'final';
      } else {                          // final: o'rta chiziqqa ergashib, ~3.7° nishab bilan tushadi
        desH = rw.h0 - clamp(cross * 0.02, -0.7, 0.7);
        altT = Math.min(gy0 + Math.max(0, F.glide * (Td - along)), gy0 + bot.gateAlt + 10);
        if (along > Td + 200) { bot.phase = 'gate'; bot.gateAlt = Math.max(60, bot.py - gy0); }   // o'tib ketdi: qayta aylanib keladi
      }
      if (clock - bot.landT > 360) {    // juda cho'zilib ketsa: joyiga qo'yiladi
        bot.px = O[0]; bot.pz = O[1]; bot.py = gy0; bot.hdg = rw.h0; bot.rd = 0; bot.gOff = 0;
        bot.spd = 0; bot.vy = 0; bot.hdgRate = 0; bot.vx = 0; bot.vz = 0; bot.pitch = 0; bot.bank = 0;
        bot.phase = 'wait'; bot.waitUntil = clock + waitTime(F);
        return;
      }
    }

    // burilish: yonboshlash burchagi cheklangan => burilish tezligi ham cheklangan; burchak tezlanishi sekin
    const spdN = Math.max(bot.spd, 14);
    const wmax = (G * Math.tan(F.bank)) / spdN;
    const err = wrapAngle(desH - bot.hdg);
    const rateT = clamp(err * 0.8, -wmax, wmax);
    const acc = wmax * 0.6 * dt;
    bot.hdgRate += clamp(rateT - bot.hdgRate, -acc, acc);
    bot.hdg = wrapAngle(bot.hdg + bot.hdgRate * dt);

    // tezlik
    let spdT;
    if (bot.phase === 'gate' || bot.phase === 'final') {
      const vApp = Math.max(vr * 1.12, bot.cruise * 0.62);
      spdT = vApp + (bot.cruise - vApp) * clamp((dLand - 700) / 1500, 0, 1);
    } else {
      spdT = bot.cruise * (1 - 0.22 * clamp(Math.abs(err) / 0.9, 0, 1));
    }
    spdT = Math.max(spdT, vr * 1.05);
    bot.spd += clamp(spdT - bot.spd, -F.decel * dt, F.accel * dt);
    bot.vx = Math.sin(bot.hdg) * bot.spd; bot.vz = Math.cos(bot.hdg) * bot.spd;
    bot.px += bot.vx * dt; bot.pz += bot.vz * dt;

    // balandlik: nishab cheklangan, vertikal tezlanish yumshoq
    const cMax = F.climb * 1.15 * spdN, sMax = F.sink * spdN;
    let vyT = clamp((altT - bot.py) * 0.45, -sMax, cMax);
    if (bot.phase === 'final') {
      const h = bot.py - gH;
      if (h < F.flareH) vyT = Math.max(vyT, -(0.6 + h * 0.3));   // yerga yaqin: sekinroq tushadi (flare)
    }
    bot.vy += clamp(vyT - bot.vy, -1.0 * dt, 1.0 * dt);
    bot.py += bot.vy * dt;

    // oxirgi himoya: to'siq/yer ichiga kirmaydi
    const landNow = bot.phase === 'gate' || bot.phase === 'final';
    bot.clr = landNow ? clamp(0.05 + Math.max(0, -along) * 0.02, 0.05, T.clearance) : Math.min(T.clearance, bot.clr + dt * 3);
    const minY = floorAt(obstacles, bot.px, bot.pz, landNow ? 1 : 2) + bot.clr;
    if (bot.py < minY) { bot.py = minY; if (bot.vy < 0) bot.vy = 0; }

    // yerga tegdi: qo'nish tugadi, endi sekin to'xtaydi
    if (bot.phase === 'final' && bot.py - groundAt(obstacles, bot.px, bot.pz) <= 0.4) {
      const dx = bot.px - rw.pts[0][0], dz = bot.pz - rw.pts[0][1];
      bot.rd = dx * Math.sin(rw.h0) + dz * Math.cos(rw.h0);
      bot.gOff = dx * Math.cos(rw.h0) - dz * Math.sin(rw.h0);
      bot.phase = 'rollout'; bot.vy = 0; bot.hdgRate = 0;
    }

    // ko'rinish: burun uchish yo'nalishi bo'yicha, hech qachon o'tkir pastga qaramaydi; yonboshlash burilishga ergashadi
    const gamma = Math.atan2(bot.vy, Math.max(bot.spd, 10));
    let pT = clamp(-(gamma + 0.04), -0.5, 0.1);
    if (bot.phase === 'final' && bot.py - gH < F.flareH) pT = Math.min(pT, -0.06);
    bot.pitch += (pT - bot.pitch) * Math.min(1, dt * 2.2);
    const bankT = -clamp(Math.atan((bot.spd * bot.hdgRate) / G), -F.bank, F.bank);
    bot.bank += (bankT - bot.bank) * Math.min(1, dt * 1.5);
  }

  // Vertolyot: tik ko'tariladi, yo'l bo'ylab silliq uchadi (burilishlarda sekinlashadi), padga yaqinlashib tik tushadi
  function patrolHeli(bot, dt) {
    const T = bot.T, F = T.fly, b = bot.baked;
    const gH = groundAt(obstacles, bot.px, bot.pz);
    if (bot.phase === 'wait') {
      bot.spd = 0; bot.vx = 0; bot.vz = 0; bot.hvx = 0; bot.hvz = 0; bot.vy = 0; bot.hdgRate = 0;
      bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 3);
      bot.bank += (0 - bot.bank) * Math.min(1, dt * 3);
      bot.py = gH + 0.05;
      if (clock >= bot.waitUntil) bot.phase = 'lift';
      return;
    }
    if (bot.phase === 'lift') {   // parrak to'liq aylangach, tik va sekin ko'tariladi
      const h = bot.py - gH;
      bot.vy += clamp((h < 2.5 ? 0.9 : 2.4) - bot.vy, -dt, dt);
      bot.py += bot.vy * dt;
      bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 3);
      bot.bank += (0 - bot.bank) * Math.min(1, dt * 3);
      if (h > F.liftH) {
        bot.phase = 'fly';
        bot.s = nearestS(b, bot.px, bot.pz, 0, 0, Math.min(b.len, 500)).s;
        bot.passedMid = false; bot.planAt = 0; bot.liftT = clock;
        bot.clr = clamp(h, 0.3, T.clearance);
      }
      return;
    }

    const landing = bot.phase === 'land';
    let tx, tz, altT, vt, dist = 0;
    if (!landing) {
      let n = nearestS(b, bot.px, bot.pz, bot.s, bot.cycle ? Math.min(25, bot.s) : 25, bot.cycle ? Math.min(120, Math.max(30, b.len - bot.s)) : 120);
      if (n.d > 400) { n = nearestS(b, bot.px, bot.pz, 0, 0, b.len); bot.s = n.s; }
      else bot.s = advanceS(bot.s, n.s, b.len, Math.max(bot.spd, 6) * dt * 2.2);
      if (bot.s > b.len * 0.5) bot.passedMid = true;
      const Ld = clamp(bot.spd * 2.0, 22, 75);
      sampleBaked(b, bot.s + Ld, A1);
      sampleBaked(b, bot.s + Ld * 2, A2);
      tx = A1.x; tz = A1.z;
      const h1 = Math.atan2(A1.x - bot.px, A1.z - bot.pz), h2 = Math.atan2(A2.x - A1.x, A2.z - A1.z);
      // burilish oldinda bo'lsa yoki burun noto'g'ri tomonga qarasa - sekinlashadi
      vt = bot.cruise * (1 - 0.5 * clamp(Math.abs(wrapAngle(h2 - h1)) / 1.2, 0, 1)) * (1 - 0.3 * clamp(Math.abs(wrapAngle(h1 - bot.hdg)) / 1.5, 0, 1));
      sampleBaked(b, bot.s + clamp(bot.spd * 2, 25, 90), A2);
      altT = A2.y;
      if (clock >= bot.planAt) {
        bot.planAt = clock + 0.2 + Math.random() * 0.06;
        const mh = bot.spd > 2 ? Math.atan2(bot.hvx, bot.hvz) : bot.hdg;
        bot.needAlt = aheadNeed(bot, mh, Math.max(70, bot.spd * 5));
      }
      altT = Math.max(altT, bot.needAlt);
      if (bot.cycle && bot.passedMid && bot.s > b.len * 0.6 && clock - bot.liftT > 20 && Math.hypot(bot.px - bot.home.x, bot.pz - bot.home.z) < F.landR) {
        bot.phase = 'land'; bot.landT = clock;
      }
    } else {
      const hx = bot.home.x, hz = bot.home.z;
      dist = Math.hypot(hx - bot.px, hz - bot.pz);
      tx = hx; tz = hz;
      vt = clamp(dist * 0.45, 0, bot.cruise);                                   // yaqinlashgan sari sekinlashadi
      altT = bot.home.y + (dist < 4 ? 0 : clamp((dist - 6) * 0.35, 0, 60));     // konus bo'ylab pastlaydi
      if (clock - bot.landT > 120) {                                           // juda cho'zilsa: joyiga qo'yiladi
        bot.px = hx; bot.pz = hz; bot.py = bot.home.y; bot.hdg = bot.home.h;
        bot.hvx = 0; bot.hvz = 0; bot.vx = 0; bot.vz = 0; bot.vy = 0; bot.spd = 0;
        bot.phase = 'wait'; bot.waitUntil = clock + waitTime(F);
        return;
      }
    }

    // gorizontal tezlik: tezlanishi cheklangan (vertolyot birdan to'xtamaydi/burilmaydi)
    const hvh = Math.atan2(tx - bot.px, tz - bot.pz);
    let ex = Math.sin(hvh) * vt - bot.hvx, ez = Math.cos(hvh) * vt - bot.hvz;
    const el = Math.hypot(ex, ez), mx = F.accel * dt;
    if (el > mx) { ex *= mx / el; ez *= mx / el; }
    bot.hvx += ex; bot.hvz += ez;
    bot.spd = Math.hypot(bot.hvx, bot.hvz);
    bot.vx = bot.hvx; bot.vz = bot.hvz;
    bot.px += bot.vx * dt; bot.pz += bot.vz * dt;

    // burun: harakat yo'nalishiga (yoki qo'nayotganda pad yo'nalishiga) sekin buriladi
    let yawT = bot.spd > 2.5 ? Math.atan2(bot.hvx, bot.hvz) : bot.hdg;
    if (landing && dist < 40) yawT = bot.home.h;
    const yerr = wrapAngle(yawT - bot.hdg);
    bot.hdgRate += clamp(clamp(yerr * 1.4, -F.yaw, F.yaw) - bot.hdgRate, -F.yaw * 1.5 * dt, F.yaw * 1.5 * dt);
    bot.hdg = wrapAngle(bot.hdg + bot.hdgRate * dt);

    // balandlik
    const cMax = Math.min(4, 1.5 + bot.spd * 0.3), sMax = Math.min(3.5, 1.2 + bot.spd * 0.25);
    let vyT = clamp((altT - bot.py) * 0.5, -sMax, cMax);
    if (landing) vyT = Math.max(vyT, -(0.5 + (bot.py - gH) * 0.2));
    bot.vy += clamp(vyT - bot.vy, -1.5 * dt, 1.5 * dt);
    bot.py += bot.vy * dt;

    bot.clr = landing ? clamp(0.05 + dist * 0.12, 0.05, T.clearance) : Math.min(T.clearance, bot.clr + dt * 3);
    const minY = floorAt(obstacles, bot.px, bot.pz, landing ? 1 : 2) + bot.clr;
    if (bot.py < minY) { bot.py = minY; if (bot.vy < 0) bot.vy = 0; }

    if (landing && dist < 3 && bot.py - gH <= bot.clr + 0.15) {   // tegdi: parrak sekin to'xtaydi
      bot.px = bot.home.x; bot.pz = bot.home.z; bot.py = bot.home.y;
      bot.hvx = 0; bot.hvz = 0; bot.vx = 0; bot.vz = 0; bot.vy = 0; bot.spd = 0; bot.hdgRate = 0;
      bot.phase = 'wait'; bot.waitUntil = clock + waitTime(F);
      return;
    }

    const fwd = bot.hvx * Math.sin(bot.hdg) + bot.hvz * Math.cos(bot.hdg);
    const side = bot.hvx * Math.cos(bot.hdg) - bot.hvz * Math.sin(bot.hdg);   // chap tomonga siljish musbat
    const pT = clamp((fwd / bot.cruise) * 0.22, -0.2, 0.28);
    const bT = -clamp((side / bot.cruise) * 0.5 + bot.hdgRate * 0.1, -T.maxBank * 1.4, T.maxBank * 1.4);
    bot.pitch += (pT - bot.pitch) * Math.min(1, dt * 2.5);
    bot.bank += (bT - bot.bank) * Math.min(1, dt * 2);
  }

  // Oddiy botning bir freymi: holat + ko'rinish
  function stepPatrol(bot, dt, cx, cy, cz) {
    dt = Math.min(dt, 0.1);
    if (dt > 0) {
      if (bot.kind === 'plane') {
        const vr = bot.cruise * bot.T.fly.vr;
        if (bot.phase === 'wait') {
          bot.spd = 0; bot.vx = 0; bot.vz = 0; bot.vy = 0;
          bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 3);
          bot.bank += (0 - bot.bank) * Math.min(1, dt * 3);
          if (clock >= bot.waitUntil) bot.phase = 'roll';
        } else if (bot.phase === 'roll' || bot.phase === 'rollout') planeGround(bot, dt, vr);
        else planeFly(bot, dt, vr);
      } else patrolHeli(bot, dt);
    }
    // parrak: pad yonida turganda to'xtaydi; vertolyot ko'tarilishdan ~3 s oldin parragini aylantira boshlaydi
    const spinOn = bot.kind === 'plane' ? bot.phase !== 'wait' : !(bot.phase === 'wait' && clock < bot.waitUntil - 3);
    bot.spinK += clamp((spinOn ? 1 : 0) - bot.spinK, -dt * 0.3, dt * 0.45);
    bot.mode = bot.phase === 'wait' ? 'parked' : 'patrol';
    bot.curSpeed = bot.spd;
    bot.dx = bot.px - cx; bot.dy = bot.py - cy; bot.dz = bot.pz - cz;
    if (bot.dx * bot.dx + bot.dy * bot.dy + bot.dz * bot.dz > far2) {   // uzoqda: faqat joyini yangilaymiz, chizmaymiz
      if (bot.group.visible) bot.group.visible = false;
      return;
    }
    bot.group.visible = true;
    bot.group.position.set(bot.px, bot.py, bot.pz);
    bot.group.rotation.set(bot.pitch, bot.hdg, bot.bank);
    const rate = bot.T.spin * dt * bot.spinK;
    if (rate > 0) for (const sp of bot.spin) sp.rotation.y += rate;
  }

  function update(dt, cx, cy, cz, heading = 0, silent = false) {
    clock += dt;
    if (dt > 0) {   // o'yinchining tezligi (hujum paytida nishonni oldindan hisoblash uchun)
      if (pHas) {
        const vx = (cx - pLx) / dt, vy = (cy - pLy) / dt, vz = (cz - pLz) / dt;
        if (Math.hypot(vx, vy, vz) < 150) {
          const k = Math.min(1, dt * 5);
          pvx += (vx - pvx) * k; pvy += (vy - pvy) * k; pvz += (vz - pvz) * k;
        }
      }
      pLx = cx; pLy = cy; pLz = cz; pHas = true;
    }
    for (const bot of bots) {
      if (bot.rk.length) for (const rk of bot.rk) if (rk.at && clock >= rk.at) { rk.mesh.visible = true; rk.at = 0; }   // otilgan raketa o'rniga yangisi
      if (bot.combat) { stepCombat(bot, dt, cx, cy, cz, silent); continue; }

      stepPatrol(bot, dt, cx, cy, cz);   // oddiy bot: odamdek uchadi
    }
    updateVoices(cx, cy, cz, heading, silent);
  }

  function dispose() {
    silence();
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    paths.length = 0;
    parkUsed.length = 0;
  }

  return { bots, paths, addPath, update, silence, dispose, alert, bump };
}
