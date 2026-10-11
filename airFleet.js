// DEXO GTA: havo harakati - qo'lda chizilgan yo'llar bo'ylab uchadigan AI samolyot va vertolyotlar.
//
// Yo'llar editorda chiziladi va zone.json ichida "air" ro'yxatida saqlanadi:
//   air: [{ type: 'plane' | 'heli', model?: 'airport.txt dagi nom', count: 1..6, speed?: m/s,
//           pad?: [x, z], pts: [[x, z, balandlik], ...] }]
//   pad - uchish/qo'nish joyi: yo'lning 1-nuqtasi shu joyda (yerda), bot shu yerdan ko'tariladi,
//         aylanib kelib shu yerga qo'nadi va yana uchadi.
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
  plane: { label: 'Samolyot',  minAlt: 40, maxAlt: 200, defAlt: 90, speed: 38, clearance: 18, margin: 12, maxBank: 0.6,  color: 0xff9a2e, spin: 40, padR: 170, padSlow: 0.45, range0: 250, rangeStep: 150 },
  heli:  { label: 'Vertolyot', minAlt: 12, maxAlt: 120, defAlt: 40, speed: 16, clearance: 10, margin: 7,  maxBank: 0.25, color: 0x35d0ff, spin: 25, padR: 45,  padSlow: 0.35, range0: 120, rangeStep: 80 },
};
export const AIR_MAX_POINTS = 60;
export const AIR_MAX_PATHS = Infinity;   // yo'llar soni cheksiz (botlar soni o'yinda AIR_BOT_LIMIT bilan cheklanadi)
export const AIR_MAX_BOTS = 6;
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
  const minY = pad ? 0.2 : 5;
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
  const out = { type, count: clamp(Math.round(Number(p && p.count) || 1), 1, AIR_MAX_BOTS), pts };
  if (p && typeof p.model === 'string' && p.model.trim()) out.model = p.model.trim().slice(0, 80);
  if (pad) out.pad = pad;
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
  return { cols, ramps: objects.map(makeRamp).filter(Boolean) };
}

// (x, z) nuqtada havo kemasi kamida qanday balandlikda bo'lishi kerak (margin - yon tomondan zaxira).
export function floorAt(obs, x, z, margin) {
  let h = 0;
  for (const c of obs.cols) {
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
    const k = clamp(Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5), 4, 48);   // har ~5 m da tekshiramiz
    for (let f = 0; f < k; f++) {
      const p = curve.getPoint((i + f / k) / n);
      let margin = T.margin, clr = T.clearance;
      if (pad) {   // pad yaqinida zaxira asta-sekin kamayadi: samolyot/vertolyot yerga qo'na oladi
        const t = clamp(Math.hypot(p.x - pad[0], p.z - pad[1]) / T.padR, 0, 1);
        margin = 2 + (T.margin - 2) * t;
        clr = 0.5 + (T.clearance - 0.5) * t;
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

// ---------- Havo floti ----------
// makeModel(kind, modelName?) -> { root: Object3D, spin: Object3D[] }   (kind: 'plane' | 'heli'; modelName - airport.txt dagi nom; har safar YANGI nusxa)
// obstacles -> { cols, ramps }   (game.js: { cols: colliders, ramps })
// makeVoice(kind) -> { update({ dist, pan, speed }), dispose() } | null   (ixtiyoriy; game.js: remoteAudio.createRemoteVoice)
// hearRange -> { plane: m, heli: m }   (ovoz eshitilish masofasi; undan uzoqda ovoz o'chadi)
export function createAirFleet({ scene, makeModel, obstacles, maxBots = 24, makeVoice = null, hearRange = { plane: 430, heli: 300 } }) {
  const bots = [];
  const paths = [];
  const P0 = { x: 0, y: 0, z: 0 }, P1 = { x: 0, y: 0, z: 0 }, P2 = { x: 0, y: 0, z: 0 };
  const far2 = AIR_VIEW_DIST * AIR_VIEW_DIST;

  function addPath(raw) {
    const path = normalizeAirPath(raw);
    if (path.pts.length < 3) return { ok: false, tooShort: true, bots: 0 };
    if (paths.length >= AIR_MAX_PATHS) return { ok: false, tooMany: true, bots: 0 };

    const T = AIR_TYPES[path.type];
    const checked = checkAirPath(path, obstacles, true);   // xavfli joylar avtomatik ko'tariladi
    path.pts = checked.pts;
    const baked = bakePath(path);
    paths.push(path);

    const count = Math.max(0, Math.min(path.count, maxBots - bots.length));
    const base = Math.random() * baked.len;
    for (let k = 0; k < count; k++) {
      const model = makeModel(path.type, path.model);
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';   // avval burilish (yaw), keyin burun ko'tarilishi (pitch), keyin yonboshlash (roll)
      group.add(model.root);
      group.visible = false;
      scene.add(group);
      bots.push({
        T, baked, group, spin: model.spin || [],
        s: base + (baked.len * k) / path.count,
        speed: path.speed || T.speed,
        bank: 0,
        kind: path.type, voice: null, curSpeed: 0, dx: 1e9, dy: 0, dz: 0,
      });
    }
    return { ok: checked.ok, raised: checked.raised, tooHigh: checked.tooHigh, bots: count };
  }

  function killVoice(bot) {
    if (bot.voice) { bot.voice.dispose(); bot.voice = null; }
  }
  // Hamma ovozlarni o'chiradi (pauza, o'yindan chiqish).
  function silence() { for (const bot of bots) killVoice(bot); }

  // Eng yaqin AIR_MAX_VOICES ta botning ovozi: masofa qancha uzoq bo'lsa, shuncha past va xira (remoteAudio.js),
  // chap/o'ng tomonga qarab stereo siljiydi. heading - o'yinchining qarashi (car.h).
  function updateVoices(cx, cy, cz, heading, silent) {
    if (!makeVoice) return;
    const near = [];
    if (!silent) {
      for (const bot of bots) {
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

  function update(dt, cx, cy, cz, heading = 0, silent = false) {
    for (const bot of bots) {
      const b = bot.baked;
      let sp = bot.speed;
      if (b.pad) {   // uchish/qo'nish joyi yaqinida sekinlashadi
        const d = Math.min(bot.s, b.len - bot.s);
        sp *= bot.T.padSlow + (1 - bot.T.padSlow) * clamp(d / bot.T.padR, 0, 1);
      }
      bot.s += sp * dt;
      bot.curSpeed = sp;
      if (bot.s >= b.len) bot.s -= b.len;

      sampleBaked(b, bot.s, P0);
      const dx = P0.x - cx, dy = P0.y - cy, dz = P0.z - cz;
      bot.dx = dx; bot.dy = dy; bot.dz = dz;
      if (dx * dx + dy * dy + dz * dz > far2) {            // uzoqda: faqat joyini yangilaymiz, chizmaymiz
        if (bot.group.visible) bot.group.visible = false;
        continue;
      }
      bot.group.visible = true;

      sampleBaked(b, bot.s + 6, P1);
      sampleBaked(b, bot.s + 12, P2);
      const h1 = Math.atan2(P1.x - P0.x, P1.z - P0.z);
      const h2 = Math.atan2(P2.x - P1.x, P2.z - P1.z);
      const turn = wrapAngle(h2 - h1) / 6;                  // rad/m: burilish keskinligi
      const flat = Math.hypot(P1.x - P0.x, P1.z - P0.z) || 0.001;
      const pitch = -Math.atan2(P1.y - P0.y, flat);         // burun yo'nalish bo'yicha ko'tariladi/tushadi
      const bankTarget = -clamp(Math.atan((bot.speed * bot.speed * turn) / 9.81), -bot.T.maxBank, bot.T.maxBank);
      bot.bank += (bankTarget - bot.bank) * Math.min(1, dt * 2.5);

      bot.group.position.set(P0.x, P0.y, P0.z);
      bot.group.rotation.set(pitch, h1, bot.bank);
      const rate = bot.T.spin * dt;
      for (const s of bot.spin) s.rotation.y += rate;
    }
    updateVoices(cx, cy, cz, heading, silent);
  }

  function dispose() {
    silence();
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    paths.length = 0;
  }

  return { bots, paths, addPath, update, silence, dispose };
}
