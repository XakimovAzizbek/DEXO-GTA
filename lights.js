// DEXO GTA: mashina chiroqlari. O'yin (game.js) va mashina sozlash (car-editor.js) aynan shu kodni ishlatadi,
// shuning uchun editordagi chiroq o'yindagi bilan bir xil ko'rinadi.
// Chiroq ma'lumoti car.txt dagi "light:" qatorlaridan keladi (data.js: normalizeLight).
import * as THREE from 'three';
import { MAX_LIGHTS } from './data.js';

const NOMINAL_LENGTH = 4.6;     // chiroq koordinatalari shu uzunlikdagi mashina uchun yoziladi
const OFF = 0.3;                // o'chiq chiroqning xiralik darajasi (rangning 30 foizi)
const BEAM_LENGTH = 9;

// Yumshoq yorug'lik dog'i (bir marta yasaladi)
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// Chiroq shakllari: hammasi old tomonga (+z) qaragan yassi shakl, markazi (0,0,0) da
const shapeCache = new Map();
function starShape(outer, inner, points) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
function shapeGeometry(shape) {
  if (shapeCache.has(shape)) return shapeCache.get(shape);
  let g;
  switch (shape) {
    case 'long': g = new THREE.BoxGeometry(0.5, 0.09, 0.05); break;
    case 'strip': g = new THREE.BoxGeometry(0.95, 0.03, 0.04); break;
    case 'square': g = new THREE.BoxGeometry(0.17, 0.17, 0.05); break;
    case 'ring': g = new THREE.TorusGeometry(0.12, 0.028, 8, 28); break;
    case 'star':
      g = new THREE.ExtrudeGeometry(starShape(0.15, 0.065, 5), { depth: 0.04, bevelEnabled: false });
      g.translate(0, 0, -0.02);
      break;
    case 'triangle': {
      const s = new THREE.Shape();
      s.moveTo(0, 0.13); s.lineTo(-0.13, -0.09); s.lineTo(0.13, -0.09); s.closePath();
      g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
      g.translate(0, 0, -0.02);
      break;
    }
    default: g = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24).rotateX(Math.PI / 2);   // dumaloq
  }
  shapeCache.set(shape, g);
  return g;
}
// Yorug'lik dog'ining o'lchami (eni, bo'yi) shaklga qarab
const GLOW = {
  round: [0.6, 0.6], long: [0.95, 0.4], strip: [1.5, 0.3], square: [0.6, 0.6],
  ring: [0.6, 0.6], star: [0.65, 0.65], triangle: [0.6, 0.6],
};

// Old chiroqdan yo'lga tushadigan yorug'lik nuri: uchida so'nadigan yumshoq konus
function makeBeam(color, size) {
  const radius = 1.5 * Math.sqrt(size);
  const g = new THREE.ConeGeometry(radius, BEAM_LENGTH, 20, 1, true);
  g.translate(0, -BEAM_LENGTH / 2, 0);        // uchi (0,0,0) da
  g.rotateX(-Math.PI / 2);                    // konus old tomonga (+z) ochiladi
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.max(0, 1 - pos.getZ(i) / BEAM_LENGTH) * 0.9;
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({
    color, vertexColors: true, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(g, mat);
  beam.rotation.x = 0.07;                     // biroz pastga qaraydi
  return beam;
}

function makeItem(l, x, k, lift) {
  const holder = new THREE.Group();
  holder.position.set(x * k, l.y * k + lift, l.z * k);
  holder.scale.setScalar(k);
  if (l.z < 0) holder.rotation.y = Math.PI;   // orqa chiroqlar orqaga qaraydi

  const color = new THREE.Color(l.color);
  const offColor = color.clone().multiplyScalar(OFF);
  const mat = new THREE.MeshBasicMaterial({ color: offColor.clone() });
  const mesh = new THREE.Mesh(shapeGeometry(l.shape), mat);
  mesh.scale.setScalar(l.size);
  holder.add(mesh);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Sprite(glowMat);
  const [gw, gh] = GLOW[l.shape] || GLOW.round;
  glow.scale.set(gw * l.size, gh * l.size, 1);
  glow.position.z = 0.04;
  glow.visible = false;
  holder.add(glow);

  let beam = null;
  if (l.func === 'button' && l.z >= 0) {      // faqat old chiroqlar (tugma bilan yoqiladigan) yo'lni yoritadi
    beam = makeBeam(color, l.size);
    beam.visible = false;
    holder.add(beam);
  }
  return { holder, mat, glow, glowMat, beam, func: l.func, on: false, onColor: color, offColor };
}

// lights: normalizeLight() natijalari ro'yxati. length va lift: mashina profilidan (car.txt).
// Qaytaradi: { group, hasButton, update(state), dispose() }, state = { brake, reverse, button } (true/false)
export function createCarLights(lights, { length = NOMINAL_LENGTH, lift = 0 } = {}) {
  const group = new THREE.Group();
  const k = length / NOMINAL_LENGTH;
  const list = (lights || []).slice(0, MAX_LIGHTS);
  const items = [];
  for (const l of list) {
    const xs = l.mirror && Math.abs(l.x) > 0.02 ? [l.x, -l.x] : [l.x];
    for (const x of xs) {
      const item = makeItem(l, x, k, lift);
      items.push(item);
      group.add(item.holder);
    }
  }

  function update(state) {
    for (const it of items) {
      const on = !!state[it.func];
      if (on === it.on) continue;
      it.on = on;
      it.mat.color.copy(on ? it.onColor : it.offColor);
      it.glow.visible = on;
      if (it.beam) it.beam.visible = on;
    }
  }

  function dispose() {
    for (const it of items) {
      it.mat.dispose();
      it.glowMat.dispose();
      if (it.beam) { it.beam.geometry.dispose(); it.beam.material.dispose(); }
    }
  }

  return { group, hasButton: list.some((l) => l.func === 'button'), update, dispose };
}
