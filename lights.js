// DEXO GTA: mashina chiroqlari. O'yin (game.js) va mashina sozlash (car-editor.js) aynan shu kodni ishlatadi,
// shuning uchun editordagi chiroq o'yindagi bilan bir xil ko'rinadi.
// Chiroq ma'lumoti car.txt dagi "light:" qatorlaridan keladi (data.js: normalizeLight).
//
// YANGI USUL: chiroq alohida shakl emas. Editorda qo'ygan nuqta atrofidagi mashinaning O'ZIDAGI yuzasi
// (GLB modelning chirog'i) yonadi (emissive) va ustiga yumshoq nur qo'shiladi. Old chiroqlar yo'lni ham yoritadi.
// Shakllar endi faqat yonadigan joyning shaklini beradi. Chiqarilgan API eskisi bilan bir xil + attach(model).
import * as THREE from 'three';
import { MAX_LIGHTS } from './data.js';

const NOMINAL_LENGTH = 4.6;     // chiroq koordinatalari shu uzunlikdagi mashina uchun yoziladi
const BEAM_LENGTH = 9;
const MAX_ZONES = MAX_LIGHTS * 2;   // mirror bilan ikki baravar
const BASE_RADIUS = 0.13;       // size = 1 bo'lganda yonadigan joy radiusi (nominal mashinada, metr)
const GLOW_POWER = 2.4;         // mashina yuzasining yorqinligi
const HALO_OPACITY = 0.75;      // yumshoq nur kuchi

// Yonadigan joy shakli: [x, y, z kengligi, rejim]  rejim: 0 = oval, 1 = to'rtburchak, 2 = halqa
const SHAPES = {
  round: [1, 1, 1, 0], long: [1.9, 0.7, 1, 0], strip: [3.4, 0.25, 1, 1], square: [1, 1, 1, 1],
  ring: [1, 1, 1, 2], star: [1, 1, 1, 0], triangle: [1, 1, 1, 0],
};
// Yorug'lik dog'ining o'lchami (eni, bo'yi) shaklga qarab
const GLOW = {
  round: [0.6, 0.6], long: [0.95, 0.4], strip: [1.5, 0.3], square: [0.6, 0.6],
  ring: [0.6, 0.6], star: [0.65, 0.65], triangle: [0.6, 0.6],
};

// Bir vaqtda bitta mashina ko'rinadi (o'yinda ham, editorda ham), shuning uchun uniformlar umumiy.
const U = {
  uGlowInv: { value: new THREE.Matrix4() },
  uGlowN: { value: 0 },
  uGA: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4()) },   // x, y, z, radius
  uGC: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4()) },   // r, g, b, daraja (0 = o'chiq)
  uGS: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4()) },   // shakl
};
let active = null;   // hozirgi chiroqlar (guruh matritsasi shader uchun kerak)

const VERT_DECL = 'uniform mat4 uGlowInv;\nvarying vec3 vGlowPos;\n';
const FRAG_DECL = `
uniform int uGlowN;
uniform vec4 uGA[${MAX_ZONES}];
uniform vec4 uGC[${MAX_ZONES}];
uniform vec4 uGS[${MAX_ZONES}];
varying vec3 vGlowPos;
vec3 glowAdd() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_ZONES}; i++) {
    if (i >= uGlowN) break;
    if (uGC[i].w < 0.01) continue;
    vec3 d = (vGlowPos - uGA[i].xyz) / (uGA[i].w * uGS[i].xyz);
    float r = (uGS[i].w > 0.5 && uGS[i].w < 1.5) ? max(max(abs(d.x), abs(d.y)), abs(d.z)) : length(d);
    float f = 1.0 - smoothstep(0.55, 1.0, r);
    if (uGS[i].w > 1.5) f *= smoothstep(0.3, 0.5, r);
    sum += uGC[i].rgb * (f * uGC[i].w);
  }
  return sum;
}
`;

function patchMaterial(m) {
  if (!m || m.userData.carGlow || m.isMeshBasicMaterial || m.isShaderMaterial) return;
  m.userData.carGlow = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vGlowPos = (uGlowInv * modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += glowAdd();',
    );
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|carglow`;
  m.needsUpdate = true;
}

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
  const px = x * k, py = l.y * k + lift, pz = l.z * k;
  const holder = new THREE.Group();           // faqat nur va yo'l nuri uchun (shakl yo'q)
  holder.position.set(px, py, pz);
  holder.scale.setScalar(k);
  if (l.z < 0) holder.rotation.y = Math.PI;   // orqa chiroqlar orqaga qaraydi

  const color = new THREE.Color(l.color);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: HALO_OPACITY,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Sprite(glowMat);
  const [gw, gh] = GLOW[l.shape] || GLOW.round;
  glow.scale.set(gw * l.size, gh * l.size, 1);
  glow.position.z = 0.06;
  glow.visible = false;
  holder.add(glow);

  let beam = null;
  if (l.func === 'button' && l.z >= 0) {      // faqat old chiroqlar (tugma bilan yoqiladigan) yo'lni yoritadi
    beam = makeBeam(color, l.size);
    beam.visible = false;
    holder.add(beam);
  }
  const sh = SHAPES[l.shape] || SHAPES.round;
  return { holder, glow, glowMat, beam, func: l.func, on: false, color, pos: [px, py, pz], radius: BASE_RADIUS * l.size * k, sh };
}

// lights: normalizeLight() natijalari ro'yxati. length va lift: mashina profilidan (car.txt).
// Qaytaradi: { group, hasButton, update(state), attach(model), dispose() }, state = { brake, reverse, button } (true/false)
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

  U.uGlowN.value = items.length;
  items.forEach((it, i) => {
    U.uGA.value[i].set(it.pos[0], it.pos[1], it.pos[2], it.radius);
    U.uGS.value[i].set(it.sh[0], it.sh[1], it.sh[2], it.sh[3]);
    U.uGC.value[i].set(it.color.r, it.color.g, it.color.b, 0);
  });
  for (let i = items.length; i < MAX_ZONES; i++) U.uGC.value[i].w = 0;

  function update(state) {
    items.forEach((it, i) => {
      const on = !!state[it.func];
      if (on === it.on) return;
      it.on = on;
      U.uGC.value[i].w = on ? GLOW_POWER : 0;
      it.glow.visible = on;
      if (it.beam) it.beam.visible = on;
    });
  }

  // Mashina modeli (loadCarModel().group yoki fitCarModel natijasi) qo'shilgach chaqiriladi. Qayta chaqirsa ham xavfsiz.
  function attach(model) {
    if (!model) return;
    model.traverse((o) => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(patchMaterial);
      if (o.userData.carGlowHook) return;
      o.userData.carGlowHook = true;
      const prev = o.onBeforeRender;
      o.onBeforeRender = function (...args) {
        if (active) { active.group.updateWorldMatrix(true, false); U.uGlowInv.value.copy(active.group.matrixWorld).invert(); }
        if (prev) prev.apply(this, args);
      };
    });
  }

  function dispose() {
    for (const it of items) {
      it.glowMat.dispose();
      if (it.beam) { it.beam.geometry.dispose(); it.beam.material.dispose(); }
    }
    if (active === api) { active = null; U.uGlowN.value = 0; }
  }

  const api = { group, hasButton: list.some((l) => l.func === 'button'), update, attach, dispose };
  active = api;
  return api;
}
