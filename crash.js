// DEXO GTA: avariya (to'qnashuv) - modelning urilgan joyini pachoqlash.
// GLB modelning urilgan nuqta atrofidagi uchlari (vertex) ichkariga botiriladi, shu joy qoraytiriladi va
// biroz g'ijimlanadi. Pachoqlar juda ixcham (x,y,z,kuch) - boshqa o'yinchilarga kichik matn sifatida yetkaziladi,
// shuning uchun keyin kirganlar ham aynan shu pachoqni ko'radi (har kimning telefonida bir xil).
import * as THREE from 'three';

export const MAX_DENTS = 16;   // raketa zarbasi uchun ko'proq pachoq joyi

const origData = new WeakMap();     // mesh -> asl pozitsiya/normal/rang nusxasi (ta'mirlash uchun)
const ownGeo = new WeakSet();       // bizga tegishli (nusxalangan) geometriyalar
const prepared = new WeakSet();     // rangli (vertexColors) qilib tayyorlangan modellar

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3(), _dir = new THREE.Vector3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _rootInv = new THREE.Matrix4();
const _box = new THREE.Box3();

// Modelning o'lchami (root'ning o'z koordinatasida): eni (x), balandligi (y), uzunligi (z).
export function measureModel(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox.isEmpty()) return;
    tmp.copy(o.geometry.boundingBox);
    m.multiplyMatrices(inv, o.matrixWorld);
    tmp.applyMatrix4(m);
    box.union(tmp);
  });
  if (box.isEmpty()) return { w: 1.9, h: 1.5, l: 4.5, minX: -0.95, maxX: 0.95, minY: 0, maxY: 1.5, minZ: -2.25, maxZ: 2.25 };
  return {
    w: box.max.x - box.min.x, h: box.max.y - box.min.y, l: box.max.z - box.min.z,
    minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z,
  };
}

// ---------- Pachoqlarni matnga aylantirish (Firebase'ga kichik hajmda yuborish uchun) ----------
// Format: "x,y,z,kuch;x,y,z,kuch" - x,y,z 0.1 m aniqlikda butun son. Masalan "12,-3,41,6".
export function encodeDents(list) {
  if (!list || !list.length) return null;
  return list.map((d) => `${Math.round(d.x * 10)},${Math.round(d.y * 10)},${Math.round(d.z * 10)},${d.s}`).join(';');
}
export function decodeDents(str) {
  if (typeof str !== 'string' || !str) return [];
  const out = [];
  for (const part of str.split(';').slice(0, MAX_DENTS)) {
    const [x, y, z, s] = part.split(',').map(Number);
    if ([x, y, z, s].every(Number.isFinite)) out.push({ x: x / 10, y: y / 10, z: z / 10, s: Math.max(1, Math.min(10, Math.round(s))) });
  }
  return out;
}

// Deterministik "g'ijimlanish" shovqini: bir xil joyda doim bir xil qiymat (hamma telefonda bir xil ko'rinishi uchun).
function noise(x, y, z, k) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.3) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function ownGeometry(mesh) {
  if (ownGeo.has(mesh.geometry)) return mesh.geometry;
  const g = mesh.geometry.clone();   // asl (boshqalar bilan umumiy) geometriyaga tegmaymiz
  mesh.geometry = g;
  ownGeo.add(g);
  return g;
}

// Birinchi pachoqdan oldin: hamma mesh'ga rang (vertex color) qo'shib, qoraytirish mumkin qilamiz.
// Hammasiga bir vaqtda qo'shamiz - aks holda rangsiz mesh'lar qora chiqib qolardi.
function prepareModel(root) {
  if (prepared.has(root)) return;
  prepared.add(root);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || mesh.isSkinnedMesh || !mesh.geometry.attributes.position) return;
    const g = ownGeometry(mesh);
    if (!g.attributes.color) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && !mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
    }
  });
}

function snapshot(mesh, g) {
  const copy = (attr) => {
    if (!attr) return null;
    const arr = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      arr[i * attr.itemSize] = attr.getX(i);
      if (attr.itemSize > 1) arr[i * attr.itemSize + 1] = attr.getY(i);
      if (attr.itemSize > 2) arr[i * attr.itemSize + 2] = attr.getZ(i);
    }
    return arr;
  };
  origData.set(mesh, { pos: copy(g.attributes.position), nor: copy(g.attributes.normal), col: copy(g.attributes.color) });
}

function isSkipped(mesh, root, skipSet) {
  for (let p = mesh; p && p !== root; p = p.parent) if (skipSet.has(p)) return true;
  return false;
}

// Bitta pachoqni modelga qo'llaydi. dent: {x,y,z,s} (root koordinatasida, metr; s: 1..10 kuch).
// opts: { dims (measureModel natijasi), skip: [g'ildirak/parrak kabi pachoqlanmaydigan tugunlar] }
export function applyDent(root, dent, opts) {
  const dims = opts.dims;
  const L = dims.l || 4.5;
  const s = Math.max(1, Math.min(10, dent.s));
  const R = L * (0.12 + 0.025 * s);                       // ta'sir doirasi
  const D = Math.min(L * 0.14, L * (0.02 + 0.012 * s));   // eng chuqur botish
  _c.set(dent.x, dent.y, dent.z);
  _dir.set(0, (dims.minY + dims.maxY) / 2, 0).sub(_c);    // pachoq mashina markazi tomonga botadi
  if (_dir.lengthSq() < 1e-6) _dir.set(0, -1, 0);
  _dir.normalize();

  prepareModel(root);
  root.updateMatrixWorld(true);
  _rootInv.copy(root.matrixWorld).invert();
  const skipSet = new Set(opts.skip || []);
  const R2 = R * R;

  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || mesh.isSkinnedMesh) return;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    if (!pos || isSkipped(mesh, root, skipSet)) return;
    if (!g.boundingBox) g.computeBoundingBox();
    _m.multiplyMatrices(_rootInv, mesh.matrixWorld);
    _box.copy(g.boundingBox).applyMatrix4(_m);
    if (_box.distanceToPoint(_c) > R) return;       // bu mesh urilgan joydan uzoq

    if (!origData.has(mesh)) snapshot(mesh, g);
    const nor = g.attributes.normal;
    const col = g.attributes.color;
    _inv.copy(_m).invert();

    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      const dx = _v.x - _c.x, dy = _v.y - _c.y, dz = _v.z - _c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R2) continue;
      const t = 1 - Math.sqrt(d2) / R;
      const w = t * t * (3 - 2 * t);                 // yumshoq pasayish: markazda kuchli, chetda nol

      const nx = noise(_v.x, _v.y, _v.z, 1), ny = noise(_v.x, _v.y, _v.z, 2), nz = noise(_v.x, _v.y, _v.z, 3);
      _v.x += (_dir.x * D + nx * D * 0.3) * w;
      _v.y += (_dir.y * D + ny * D * 0.3) * w;
      _v.z += (_dir.z * D + nz * D * 0.3) * w;
      _v.applyMatrix4(_inv);
      pos.setXYZ(i, _v.x, _v.y, _v.z);

      if (nor) {                                     // yorug'lik g'ijimlangan joyda "sinadi"
        _n.fromBufferAttribute(nor, i);
        _n.x += nx * 0.6 * w; _n.y += ny * 0.6 * w; _n.z += nz * 0.6 * w;
        _n.normalize();
        nor.setXYZ(i, _n.x, _n.y, _n.z);
      }
      if (col) {                                     // urilgan joy qoraroq
        const f = 1 - 0.55 * w;
        col.setXYZ(i, Math.max(0.25, col.getX(i) * f), Math.max(0.25, col.getY(i) * f), Math.max(0.25, col.getZ(i) * f));
      }
    }
    pos.needsUpdate = true;
    if (nor) nor.needsUpdate = true;
    if (col) col.needsUpdate = true;
    g.boundingBox = null;
    g.boundingSphere = null;
  });
}

// Hamma pachoqni olib tashlab, modelni asl holiga qaytaradi (ta'mirlash / "boshiga qaytarish").
export function repairModel(root) {
  root.traverse((mesh) => {
    const o = origData.get(mesh);
    if (!o || !mesh.geometry) return;
    const g = mesh.geometry;
    const put = (attr, arr) => {
      if (!attr || !arr) return;
      for (let i = 0; i < attr.count; i++) {
        const k = i * attr.itemSize;
        if (attr.itemSize === 1) attr.setX(i, arr[k]);
        else if (attr.itemSize === 2) attr.setXY(i, arr[k], arr[k + 1]);
        else attr.setXYZ(i, arr[k], arr[k + 1], arr[k + 2]);
      }
      attr.needsUpdate = true;
    };
    put(g.attributes.position, o.pos);
    put(g.attributes.normal, o.nor);
    put(g.attributes.color, o.col);
    g.boundingBox = null;
    g.boundingSphere = null;
    origData.delete(mesh);
  });
}

// Modelni olib tashlashdan oldin: nusxalangan geometriyalarni xotiradan bo'shatadi.
export function disposeCrash(root) {
  root.traverse((mesh) => {
    if (mesh.isMesh && mesh.geometry && ownGeo.has(mesh.geometry)) {
      mesh.geometry.dispose();
      ownGeo.delete(mesh.geometry);
    }
    origData.delete(mesh);
  });
  prepared.delete(root);
}
