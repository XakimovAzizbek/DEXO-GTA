// DEXO GTA: 3D modellar (kod bilan yasalgan, tashqi fayl kerak emas).
// Har bir tur BITTA geometriyaga birlashtiriladi (vertex ranglar bilan),
// shuning uchun o'yinda InstancedMesh orqali juda tez chiziladi.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CATALOG, TINTS } from './data.js';

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

const BUILDERS = {
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
export function getGeometry(type) {
  if (!geoCache.has(type)) geoCache.set(type, BUILDERS[type]());
  return geoCache.get(type);
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
