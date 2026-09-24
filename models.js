// DEXO GTA: 3D modellar (kod bilan yasalgan, tashqi fayl kerak emas).
// Har bir tur BITTA geometriyaga birlashtiriladi (vertex ranglar bilan),
// shuning uchun o'yinda InstancedMesh orqali juda tez chiziladi.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CATALOG, TINTS, TRAFFIC_LIGHT_HEX, TRAFFIC_LIGHT_DIM, trafficActiveIndex } from './data.js';

const TL_POLE_H = 3.0; // svetofor ustunining balandligi (metr), bosh qutisi shundan yuqorida boshlanadi

export const CITY_URL = 'assets/procedural_city_6.glb';

const _color = new THREE.Color();

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _color.set(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _color.r; arr[i * 3 + 1] = _color.g; arr[i * 3 + 2] = _color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function box(w, h, d, x, y, z, hex, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, hex);
}
function cyl(rt, rb, h, seg, x, y, z, hex) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}
function cone(r, h, seg, x, y, z, hex) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}
function blob(r, x, y, z, hex, sy = 1) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return paint(g, hex);
}
function finish(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// To'rtburchak tom (piramida shaklida)
function hipRoof(parts, hw, hd, baseY, h, hex, over = 0.6) {
  const g = new THREE.ConeGeometry(1, h, 4, 1);
  g.rotateY(Math.PI / 4);                       // asosi o'qlarga to'g'ri keladi, yarim eni = 0.7071
  g.scale((hw + over) / 0.70710678, 1, (hd + over) / 0.70710678);
  g.translate(0, baseY + h / 2, 0);
  parts.push(paint(g, hex));
}

// Devorga oynalar qatori
function windowGrid(parts, hw, hd, floors, floorH, baseY, hex, opts = {}) {
  const faces = [
    { len: 2 * hw, nx: 0, nz: 1, ry: 0 },
    { len: 2 * hw, nx: 0, nz: -1, ry: 0 },
    { len: 2 * hd, nx: 1, nz: 0, ry: Math.PI / 2 },
    { len: 2 * hd, nx: -1, nz: 0, ry: Math.PI / 2 },
  ];
  for (const f of faces) {
    if (opts.skipFront && f.nz === 1) continue;
    const cols = Math.max(1, Math.floor(f.len / 3.4));
    const step = f.len / cols;
    for (let fl = 0; fl < floors; fl++) {
      for (let c = 0; c < cols; c++) {
        const p = -f.len / 2 + step * (c + 0.5);
        if (opts.skipDoor && fl === 0 && f.nz === 1 && Math.abs(p) < 1.6) continue;
        const y = baseY + floorH * fl + floorH * 0.55;
        const off = (f.nz !== 0 ? hd : hw) + 0.04;
        const x = f.nz !== 0 ? p : f.nx * off;
        const z = f.nz !== 0 ? f.nz * off : p;
        parts.push(box(1.4, 1.5, 0.1, x, y, z, hex, f.ry));
      }
    }
  }
}

// Rampa/baland yo'l: eni 12, uzunligi 24 m. Past uchi hLow, yuqori uchi (+z) hHigh balandlikda.
// Ostida yergacha to'la tayanch (damba) bor, havoda osilib turmaydi.
function rampGeometry(hLow, hHigh) {
  const hw = 6, hd = 12;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [];
  const quad = (p0, p1, p2, p3, out, hex) => {
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (n.lengthSq() < 1e-9) return;                       // yuzasi nol tomonni o'tkazib yuboramiz
    const [a, b, c, d] = n.dot(out) >= 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
    n.normalize();
    if (n.dot(out) < 0) n.negate();
    const v = [a, b, c, a, c, d];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(v.flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(v.length * 2).fill(0), 2));
    parts.push(paint(g, hex));
  };
  const A = P(-hw, 0, -hd), B = P(hw, 0, -hd), C = P(hw, 0, hd), D = P(-hw, 0, hd);          // pastki (yer)
  const a = P(-hw, hLow, -hd), b = P(hw, hLow, -hd), c = P(hw, hHigh, hd), d = P(-hw, hHigh, hd);  // yuqori (yo'l sirti)
  quad(a, b, c, d, new THREE.Vector3(0, 1, 0), '#3a3f47');       // asfalt
  quad(D, C, c, d, new THREE.Vector3(0, 0, 1), '#6b7078');       // old (yuqori uch) devori
  quad(A, B, b, a, new THREE.Vector3(0, 0, -1), '#6b7078');      // orqa (past uch) devori
  quad(B, C, c, b, new THREE.Vector3(1, 0, 0), '#6b7078');       // o'ng yon devor
  quad(A, D, d, a, new THREE.Vector3(-1, 0, 0), '#6b7078');      // chap yon devor

  // Chiziqlar nishabga mos qiyshaytiriladi
  const theta = Math.atan2(hHigh - hLow, 2 * hd);
  const mark = (w, l, x, zc, hex) => {
    const g = new THREE.BoxGeometry(w, 0.06, l);
    g.rotateX(-theta);
    g.translate(x, hLow + ((hHigh - hLow) * (zc + hd)) / (2 * hd) + 0.03, zc);
    parts.push(paint(g, hex));
  };
  for (const zc of [-10, -6, -2, 2, 6, 10]) mark(0.3, 2.4, 0, zc, '#ffc933');
  mark(0.25, (2 * hd) / Math.cos(theta), -5.5, 0, '#e9ecef');
  mark(0.25, (2 * hd) / Math.cos(theta), 5.5, 0, '#e9ecef');
  return finish(parts);
}

const BUILDERS = {
  ramp_up(level = 0) { return rampGeometry(level, level + 3); },
  ramp_flat(level = 3) { return rampGeometry(level, level); },
  house_small() {
    const hw = 4, hd = 4, h = 3.4, p = [];
    p.push(box(hw * 2 + 0.5, 0.3, hd * 2 + 0.5, 0, 0.15, 0, '#9aa0a6'));
    p.push(box(hw * 2, h, hd * 2, 0, h / 2, 0, '#eadfc8'));
    hipRoof(p, hw, hd, h, 2.6, '#a4472f');
    p.push(box(0.9, 2, 0.9, hw * 0.4, h + 1.8, -hd * 0.3, '#8c5a49'));
    p.push(box(1.3, 2.3, 0.16, 0, 1.15, hd + 0.05, '#6b4226'));
    windowGrid(p, hw, hd, 1, 3, 0.3, '#8fc4e8', { skipDoor: true });
    return finish(p);
  },
  house_two() {
    const hw = 5, hd = 4.5, h = 6.2, p = [];
    p.push(box(hw * 2 + 0.5, 0.3, hd * 2 + 0.5, 0, 0.15, 0, '#9aa0a6'));
    p.push(box(hw * 2, h, hd * 2, 0, h / 2, 0, '#e7d5bd'));
    p.push(box(hw * 2 + 0.2, 0.25, hd * 2 + 0.2, 0, 3.2, 0, '#c9b79a'));   // qavatlar orasidagi belbog'
    hipRoof(p, hw, hd, h, 2.8, '#7a3b2e');
    p.push(box(3, 0.2, 1.4, 0, 3.3, hd + 0.7, '#b0b7bd'));                 // balkon
    p.push(box(1.3, 2.3, 0.16, 0, 1.15, hd + 0.05, '#5a3a22'));
    windowGrid(p, hw, hd, 2, 3.1, 0.3, '#8fc4e8', { skipDoor: true });
    return finish(p);
  },
  shop() {
    const hw = 6, hd = 4.5, h = 4.4, p = [];
    p.push(box(hw * 2 + 0.4, 0.25, hd * 2 + 0.4, 0, 0.125, 0, '#8d8f93'));
    p.push(box(hw * 2, h, hd * 2, 0, h / 2, 0, '#c8b48f'));
    p.push(box(hw * 2 + 0.4, 0.5, hd * 2 + 0.4, 0, h + 0.25, 0, '#8d8f93'));
    p.push(box(8, 2.4, 0.14, 0, 1.6, hd + 0.05, '#86bcd9'));               // vitrina
    p.push(box(9, 0.2, 1.8, 0, 3.3, hd + 0.9, '#d94a3d'));                 // soyabon
    p.push(box(6, 1, 0.3, 0, h + 1.0, hd - 0.4, '#ffc933'));               // tepadagi lavha
    windowGrid(p, hw, hd, 1, 3.6, 0.5, '#8fc4e8', { skipFront: true });
    return finish(p);
  },
  tower() {
    const hw = 7, hd = 7, h = 31, p = [];
    p.push(box(hw * 2 + 2, 4, hd * 2 + 2, 0, 2, 0, '#5f6b7a'));            // podium
    p.push(box(hw * 2, h, hd * 2, 0, h / 2, 0, '#7f8fa3'));
    p.push(box(4, 3, 0.2, 0, 1.5, hd + 1.05, '#2a3b4c'));                  // kirish
    windowGrid(p, hw, hd, 7, 3.7, 4.2, '#cfe6ff');
    p.push(box(hw * 2 + 0.6, 0.8, hd * 2 + 0.6, 0, h + 0.4, 0, '#4d5867'));
    p.push(box(3, 1.4, 2.4, -3, h + 1.5, 2, '#9aa4b1'));
    p.push(box(2.4, 1.2, 2.4, 3, h + 1.4, -2, '#9aa4b1'));
    p.push(cyl(0.12, 0.12, 7, 5, 0, h + 4.3, 0, '#c9ced6'));
    return finish(p);
  },
  tree_pine() {
    const p = [];
    p.push(cyl(0.35, 0.45, 2.2, 6, 0, 1.1, 0, '#6b4a2f'));
    p.push(cone(2.6, 3.4, 7, 0, 3.6, 0, '#2e7048'));
    p.push(cone(2.1, 3.0, 7, 0, 5.4, 0, '#347a4f'));
    p.push(cone(1.5, 2.6, 7, 0, 7.1, 0, '#3b8a58'));
    return finish(p);
  },
  tree_round() {
    const p = [];
    p.push(cyl(0.3, 0.45, 3, 6, 0, 1.5, 0, '#6b4a2f'));
    p.push(blob(2.3, 0, 4.3, 0, '#5b9a3f', 0.9));
    p.push(blob(1.6, 1.2, 5.2, 0.6, '#6aae4a'));
    p.push(blob(1.5, -1.1, 4.9, -0.7, '#4f8a37'));
    return finish(p);
  },
  road_straight() {
    const p = [];
    p.push(box(12, 0.08, 24, 0, 0.04, 0, '#3a3f47'));
    p.push(box(0.25, 0.09, 24, -5.5, 0.045, 0, '#e9ecef'));
    p.push(box(0.25, 0.09, 24, 5.5, 0.045, 0, '#e9ecef'));
    for (let i = 0; i < 6; i++) p.push(box(0.3, 0.09, 2.4, 0, 0.05, -10 + i * 4, '#ffc933'));
    return finish(p);
  },
  road_cross() {
    const p = [];
    p.push(box(12, 0.08, 12, 0, 0.04, 0, '#3a3f47'));
    for (let i = -2; i <= 2; i++) {                                         // piyodalar o'tish joyi
      p.push(box(0.8, 0.09, 2.2, i * 2, 0.05, 4.7, '#e9ecef'));
      p.push(box(0.8, 0.09, 2.2, i * 2, 0.05, -4.7, '#e9ecef'));
      p.push(box(2.2, 0.09, 0.8, 4.7, 0.05, i * 2, '#e9ecef'));
      p.push(box(2.2, 0.09, 0.8, -4.7, 0.05, i * 2, '#e9ecef'));
    }
    return finish(p);
  },
  // ----- Tabiat -----
  mountain_big() {
    const p = [];
    p.push(cone(34, 60, 9, 0, 30, 0, '#7a8570'));
    p.push(cone(20, 46, 8, 14, 23, -6, '#6f7a66'));
    p.push(cone(18, 38, 7, -17, 19, 9, '#808b76'));
    p.push(cone(10.8, 18, 9, 0, 51, 0, '#f3f6fa'));          // qor (asosiy cho'qqi)
    p.push(cone(5.2, 10, 7, -17, 33, 9, '#f3f6fa'));         // qor (ikkinchi cho'qqi)
    return finish(p);
  },
  mountain_small() {
    const p = [];
    p.push(cone(20, 30, 8, 0, 15, 0, '#7d8872'));
    p.push(cone(12, 22, 7, 8, 11, 4, '#748069'));
    return finish(p);
  },
  hill() {
    const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(14, 6, 14);
    return finish([paint(g, '#6a9a4f')]);
  },
  ridge() {
    const p = [];
    for (const [x, sx, sy, sz] of [[-12, 12, 6, 8], [0, 14, 8, 9], [12, 11, 5.5, 7.5]]) {
      const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(sx, sy, sz);
      g.translate(x, 0, 0);
      p.push(paint(g, '#658f4b'));
    }
    return finish(p);
  },
  rock() {
    const a = new THREE.IcosahedronGeometry(1, 0);
    a.scale(2.6, 2.0, 2.2);
    a.translate(0, 1.4, 0);
    const b = new THREE.IcosahedronGeometry(1, 0);
    b.scale(1.3, 1.0, 1.2);
    b.translate(2.4, 0.7, 1);
    return finish([paint(a, '#8b9096'), paint(b, '#7b8087')]);
  },
  // ----- Yer maydonlari (40 x 40 m, tekis; kattalashtirib kengaytirish mumkin) -----
  land_grass() {
    const p = [box(40, 0.05, 40, 0, 0.025, 0, '#4f7f3f')];
    for (const [x, z, w, d] of [[-9, 7, 10, 7], [11, -10, 8, 9], [5, 13, 12, 5]]) p.push(box(w, 0.06, d, x, 0.03, z, '#5b8c47'));
    return finish(p);
  },
  land_sand() {
    const p = [box(40, 0.05, 40, 0, 0.025, 0, '#d9c48f')];
    for (const [x, z, w, d] of [[-9, 7, 10, 7], [11, -10, 8, 9], [5, 13, 12, 5]]) p.push(box(w, 0.06, d, x, 0.03, z, '#cdb57c'));
    return finish(p);
  },
  land_dirt() {
    const p = [box(40, 0.05, 40, 0, 0.025, 0, '#8a6a45')];
    for (const [x, z, w, d] of [[-9, 7, 10, 7], [11, -10, 8, 9], [5, 13, 12, 5]]) p.push(box(w, 0.06, d, x, 0.03, z, '#7b5c3b'));
    return finish(p);
  },
  land_asphalt() {
    const p = [box(40, 0.05, 40, 0, 0.025, 0, '#454b55')];
    for (const sgn of [-1, 1]) {
      p.push(box(38, 0.06, 0.25, 0, 0.03, sgn * 19, '#e9ecef'));
      p.push(box(0.25, 0.06, 38, sgn * 19, 0.03, 0, '#e9ecef'));
    }
    return finish(p);
  },
  // Marshrut nuqtasi: faqat editorda ko'rinadi (o'yin uni chizmaydi). Bayroq rangi marshrut guruhini bildiradi.
  route_point() {
    const p = [];
    p.push(cyl(0.16, 0.16, 0.04, 12, 0, 0.04, 0, '#2b2f38'));            // tag
    p.push(cyl(0.05, 0.07, 1.4, 6, 0, 0.7, 0, '#3a4048'));                // ustun
    p.push(box(0.55, 0.34, 0.03, 0.29, 1.26, 0, '#ffffff'));              // bayroq (marshrut rangida tiniladi)
    return finish(p);
  },
  billboard() {
    const p = [];
    p.push(box(2.6, 0.4, 1.8, 0, 0.2, 0, '#6d7581'));                        // poydevor
    p.push(cyl(0.55, 0.75, 9, 10, 0, 4.5, 0, '#98a1ad'));                     // ustun
    p.push(box(13, 7, 0.8, 0, 12.5, 0, '#3f4650'));                            // ramka
    p.push(box(12, 6, 0.02, 0, 12.5, 0.405, '#14171d'));                       // ekran (old tomon)
    p.push(box(12, 6, 0.02, 0, 12.5, -0.405, '#14171d'));                      // ekran (orqa tomon)
    p.push(box(12.6, 0.12, 0.9, 0, 9.0, 0.7, '#59626e'));                      // pastki yo'lak
    for (const x of [-4.5, 0, 4.5]) {
      p.push(box(0.12, 0.12, 1.1, x, 16.25, 0.55, '#59626e'));                // chiroq tayanchi
      p.push(box(0.7, 0.22, 0.6, x, 16.3, 1.15, '#eef1f4'));                   // chiroq
    }
    return finish(p);
  },
  traffic_light() {
    const p = [];
    p.push(cyl(0.1, 0.13, TL_POLE_H, 8, 0, TL_POLE_H / 2, 0, '#3a3f47'));         // ustun
    p.push(box(0.7, 2.2, 0.34, 0, TL_POLE_H + 1.1, 0, '#20242b'));                // bosh qutisi
    p.push(box(0.5, 0.1, 0.14, 0, TL_POLE_H + 2.22, 0, '#20242b'));               // tepa qopqog'i
    p.push(cyl(0.16, 0.16, 0.3, 8, 0, 0.15, 0, '#3a3f47'));                       // asos
    return finish(p);
  },
  spawn() {
    const p = [];
    p.push(cyl(2.4, 2.4, 0.12, 24, 0, 0.06, 0, '#ffc933'));
    p.push(box(0.8, 0.14, 2.6, 0, 0.14, -0.1, '#1b1f27'));
    const head = new THREE.ConeGeometry(1.1, 1.6, 3);
    head.rotateX(Math.PI / 2);                                              // uchi +z ga qaraydi
    head.translate(0, 0.14, 2.0);
    p.push(paint(head, '#1b1f27'));
    return finish(p);
  },
};

const geoCache = new Map();
// level: faqat rampalar uchun (past uchining balandligi); har bir balandlik uchun alohida model quriladi
export function getGeometry(type, level = 0) {
  const key = CATALOG[type].kind === 'ramp' ? `${type}:${level}` : type;
  if (!geoCache.has(key)) geoCache.set(key, BUILDERS[type](level));
  return geoCache.get(key);
}

const matCache = new Map();
export function getMaterial(kind, tint = 0) {
  const list = TINTS[kind];
  const key = kind + ':' + (tint % list.length);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({ vertexColors: true, color: list[tint % list.length] }));
  }
  return matCache.get(key);
}
export function tintColor(kind, tint = 0) {
  const list = TINTS[kind];
  return new THREE.Color(list[tint % list.length]);
}

export function kindOf(type) { return CATALOG[type].kind; }

// ---------- Svetofor: statik ustun+quti (getGeometry orqali) + 3 ta alohida chiroq mesh (rangi vaqt bilan almashadi) ----------
export function buildTrafficLightGroup(data) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(getGeometry('traffic_light', 0), getMaterial('traffic_light', data.c));
  group.add(body);
  const lightMeshes = [];
  for (let i = 0; i < 3; i++) {
    const l = data.lights[i];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8),
      new THREE.MeshBasicMaterial({ color: TRAFFIC_LIGHT_DIM[l.color] }),
    );
    mesh.position.set(l.dx, TL_POLE_H + l.dy, 0.2);
    group.add(mesh);
    lightMeshes.push(mesh);
  }
  group.userData.lightMeshes = lightMeshes;
  return group;
}
// Chiroqlar joyi/soniyasi editorda o'zgarganda pozitsiyalarni qayta qo'yish uchun.
export function refreshTrafficLightGroup(group, data) {
  const lightMeshes = group.userData.lightMeshes;
  if (!lightMeshes) return;
  for (let i = 0; i < 3; i++) {
    const l = data.lights[i];
    lightMeshes[i].position.set(l.dx, TL_POLE_H + l.dy, 0.2);
  }
}
// Har freymda chaqiriladi: qaysi chiroq yonganini vaqt bo'yicha hisoblab, ranglarni yangilaydi.
export function updateTrafficLightGroup(group, data, timeSec) {
  const lightMeshes = group.userData.lightMeshes;
  if (!lightMeshes) return;
  const active = trafficActiveIndex(data.lights, data.start || 0, timeSec);
  for (let i = 0; i < 3; i++) {
    const l = data.lights[i];
    lightMeshes[i].material.color.set(i === active ? TRAFFIC_LIGHT_HEX[l.color] : TRAFFIC_LIGHT_DIM[l.color]);
  }
}

// Tayyor shahar modeli (ixtiyoriy, juda og'ir). Topilmasa xato tashlaydi.
export async function loadCity(onProgress) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(CITY_URL, (e) => {
    if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
  });
  const root = gltf.scene;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m && m.transmission > 0) {        // shisha (transmission) juda qimmat: oddiy shaffoflikka almashtiramiz
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.45;
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);   // markazga qo'yamiz, eng pastki nuqta y=0 da
  return root;
}

// ---------- Haqiqiy mashina (GLB) ----------
// Metall bo'yoq to'g'ri ko'rinishi uchun yorug'lik muhiti (faqat PBR materiallarga ta'sir qiladi).
export function makeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

async function makeGLTFLoader() {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// car = car.txt dagi yozuv (name, file, rotate, length, lift ...). Fayl avval cars/ papkasidan, keyin asosiy papkadan qidiriladi.
// GLB sahnasini yuklaydi (hali o'lchamlanmagan).
export async function loadCarScene(car, onProgress) {
  const loader = await makeGLTFLoader();
  let gltf = null, lastError = null;
  for (const path of [`cars/${car.file}`, car.file]) {
    try {
      gltf = await loader.loadAsync(path, (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      });
      break;
    } catch (err) { lastError = err; }
  }
  if (!gltf) throw lastError || new Error('Mashina fayli topilmadi');

  const model = gltf.scene;
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.transmission > 0) {          // shisha (transmission) juda qimmat: oddiy shaffoflik
        m.transmission = 0;
        m.transparent = true;
        m.opacity = Math.min(m.opacity, 0.4);
      }
      if (m.isMeshStandardMaterial) m.envMapIntensity = 1;
    }
  });
  return model;
}

// Faqat KO'RINADIGAN qismlarning aniq (uchma-uch) chegara qutisi. Yashirin yordamchi qismlar va
// burilgan detallarning katta qutilari mashinani markazdan siljitib yubormasligi uchun.
function visibleBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverseVisible((o) => {
    const pos = o.isMesh && o.geometry && o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}

// Modelni o'lchamlaydi: uzunligi car.length metr, markazi (0,0) da, g'ildiraklari y = car.lift da,
// old tomoni +z ga qaragan. Sozlamalar o'zgarsa shu funksiyani qayta chaqirish yetadi (qayta yuklash shart emas).
export function fitCarModel(model, car) {
  model.removeFromParent();
  if (!model.userData.fitBox) model.userData.fitBox = visibleBox(model);   // bir marta o'lchanadi
  const b = model.userData.fitBox;
  const raw = b.getSize(new THREE.Vector3());

  // Uzun tomonni z o'qiga to'g'rilaymiz; rotate: 180 bo'lsa old va orqa almashadi
  const yaw = (raw.x > raw.z ? Math.PI / 2 : 0) + THREE.MathUtils.degToRad(car.rotate || 0);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const x of [b.min.x, b.max.x]) {
    for (const z of [b.min.z, b.max.z]) {
      const rx = x * c + z * s, rz = -x * s + z * c;       // three.js dagi rotation.y qoidasi
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
    }
  }
  const k = (car.length || 4.6) / Math.max(maxZ - minZ, 0.001);

  const inner = new THREE.Group();
  inner.add(model);
  inner.rotation.y = yaw;
  inner.scale.setScalar(k);
  inner.position.set(-k * (minX + maxX) / 2, -k * b.min.y + (car.lift || 0), -k * (minZ + maxZ) / 2);

  const root = new THREE.Group();
  root.add(inner);
  return root;
}

export async function loadCarModel(car, onProgress) {
  return fitCarModel(await loadCarScene(car, onProgress), car);
}

// Modelni xotiradan tozalash (mashina almashtirilganda)
export function disposeModel(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}
