import * as THREE from 'three';
import {
  CAR_DEFAULTS, cameraPose, fetchCarList, loadSelectedCarName, saveSelectedCarName,
  loadCarDraft, saveCarDraft, serializeCarList,
  LIGHT_SHAPES, LIGHT_FUNCS, LIGHT_FUNC_DEFAULTS, MAX_LIGHTS, normalizeLight,
} from './data.js';
import {
  getGeometry, getMaterial, makeEnvironment, loadCarScene, fitCarModel, disposeModel,
} from './models.js';
import { showSaveDialog } from './savefile.js';
import { createCarLights } from './lights.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PROFILE_KEYS = Object.keys(CAR_DEFAULTS);

// ---------- Renderer ----------
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', '<p class="fatal">Brauzeringiz 3D (WebGL) ni qo‘llamayapti.</p>');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);

// ---------- Sahna: o'yindagi kabi yo'l, uylar, daraxtlar ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9d0ea');
scene.fog = new THREE.Fog('#a9d0ea', 90, 340);
scene.environment = makeEnvironment(renderer);
scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x6f7a55, 1.05));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
sun.position.set(40, 70, 25);
scene.add(sun);

const outer = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#5f8a49' }));
outer.position.y = -0.05;
scene.add(outer);
const zoneGround = new THREE.Mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#6f9a55' }));
zoneGround.position.y = 0.005;
scene.add(zoneGround);

for (let i = -6; i <= 6; i++) {
  const road = new THREE.Mesh(getGeometry('road_straight'), getMaterial('road', 0));
  road.position.set(0, 0, i * 24);
  scene.add(road);
}
const decor = [
  ['house_small', 13, 26, -Math.PI / 2], ['house_two', -13.5, 42, Math.PI / 2], ['shop', 13.5, 60, -Math.PI / 2],
  ['house_small', -13, -22, Math.PI / 2], ['house_two', 13.5, -34, -Math.PI / 2],
  ['tree_pine', 20, 8, 0], ['tree_round', -20, 14, 1], ['tree_pine', -19, -10, 2], ['tree_round', 21, -14, 0.5],
];
for (const [type, x, z, r] of decor) {
  const kind = type.startsWith('tree') ? 'tree' : 'house';
  const mesh = new THREE.Mesh(getGeometry(type), getMaterial(kind, 0));
  mesh.position.set(x, 0, z);
  mesh.rotation.y = r;
  scene.add(mesh);
}

const carRoot = new THREE.Group();   // yo'nalish
const carTilt = new THREE.Group();   // engashish
carRoot.add(carTilt);
scene.add(carRoot);

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 700);

// ---------- Holat ----------
const profile = { ...CAR_DEFAULTS };
const test = { speedKmh: 0, demo: false };
let carEntry = null;          // { name, file } hozir tahrirlanayotgan mashina
let modelScene = null;        // yuklangan GLB
let fitted = null;            // o'lchamlangan model
let loadToken = 0;
let lights = [];              // tahrirlanayotgan mashinaning chiroqlari
let selLight = -1;            // tanlangan chiroq raqami
let lightsObj = null;         // sahnadagi chiroqlar (lights.js)
const lightPreview = { brake: true, reverse: true, button: true };   // ko'rish uchun yoqib qo'yiladiganlar

let toastTimer = 0;
function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const pickProfile = (src) => Object.fromEntries(PROFILE_KEYS.map((k) => [k, Number(src[k])]));

// ---------- Sozlash qatorlari ----------
const CONTROLS = [
  { tab: 'camera', key: 'carx', label: 'Mashina: chapga ↔ o‘ngga', min: -4, max: 4, step: 0.1, unit: 'm' },
  { tab: 'camera', key: 'carz', label: 'Mashina: orqaga ↔ oldinga', min: -6, max: 6, step: 0.1, unit: 'm' },
  { tab: 'camera', key: 'camdist', label: 'Kamera masofasi', min: 5, max: 20, step: 0.5, unit: 'm' },
  { tab: 'camera', key: 'camheight', label: 'Kamera balandligi', min: 1.6, max: 14, step: 0.1, unit: 'm' },
  { tab: 'camera', key: 'aimy', label: 'Nishon balandligi', min: 0, max: 4, step: 0.1, unit: 'm' },
  { tab: 'camera', key: 'fov', label: 'Ko‘rish burchagi', min: 40, max: 90, step: 1, unit: '°' },
  { tab: 'camera', key: 'fovspeed', label: 'Tezlikda kengayish', min: 0, max: 0.8, step: 0.05, unit: '' },
  { tab: 'camera', key: 'follow', label: 'Kamera ergashishi', min: 2, max: 20, step: 0.5, unit: '' },
  { tab: 'car', key: 'length', label: 'Mashina kattaligi (uzunligi)', min: 3, max: 7, step: 0.1, unit: 'm' },
  { tab: 'car', key: 'lift', label: 'Yerdan balandligi', min: -0.5, max: 0.5, step: 0.02, unit: 'm' },
  { tab: 'car', key: 'tilt', label: 'Engashish kuchi', min: 0, max: 2.5, step: 0.1, unit: '' },
  { tab: 'test', key: 'testSpeed', label: 'Sinov tezligi (faqat ko‘rish uchun)', min: 0, max: 150, step: 5, unit: 'km/soat', test: true },
];
const rows = new Map();   // key -> { def, input, output }

const fmt = (def, v) => {
  const digits = def.step < 0.1 ? 2 : def.step < 1 ? 1 : 0;
  return `${Number(v).toFixed(digits)}${def.unit ? ' ' + def.unit : ''}`;
};
const valueOf = (def) => (def.test ? test.speedKmh : profile[def.key]);

function buildRow(def) {
  const row = document.createElement('div');
  row.className = 'row';

  const head = document.createElement('div');
  head.className = 'row-head';
  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = def.label;
  const output = document.createElement('output');
  output.className = 'row-value';
  head.append(label, output);

  const ctl = document.createElement('div');
  ctl.className = 'row-ctl';
  const minus = document.createElement('button');
  minus.type = 'button'; minus.className = 'step'; minus.textContent = '−'; minus.setAttribute('aria-label', `${def.label}: kamaytirish`);
  const plus = document.createElement('button');
  plus.type = 'button'; plus.className = 'step'; plus.textContent = '+'; plus.setAttribute('aria-label', `${def.label}: oshirish`);
  const input = document.createElement('input');
  input.type = 'range'; input.min = def.min; input.max = def.max; input.step = def.step;
  input.setAttribute('aria-label', def.label);
  ctl.append(minus, input, plus);
  row.append(head, ctl);

  input.addEventListener('input', () => setValue(def, Number(input.value)));
  const nudge = (dir) => {
    const v = clamp(Math.round((valueOf(def) + dir * def.step) / def.step) * def.step, def.min, def.max);
    setValue(def, Math.round(v * 1000) / 1000);
  };
  minus.addEventListener('click', () => nudge(-1));
  plus.addEventListener('click', () => nudge(1));

  rows.set(def.key, { def, input, output });
  const panel = document.querySelector(`[data-tabpanel="${def.tab}"]`);
  const flip = panel.querySelector('#flipRow');
  if (flip) panel.insertBefore(row, flip);          // "Mashina" paneli: "oldi/orqa" qatoridan oldin
  else if (def.tab === 'test') panel.prepend(row);  // "Sinov" paneli: eng tepada
  else panel.append(row);
}
CONTROLS.forEach(buildRow);

function syncControls() {
  for (const { def, input, output } of rows.values()) {
    const v = valueOf(def);
    input.value = v;
    output.textContent = fmt(def, v);
  }
  $('flip').textContent = profile.rotate === 180 ? 'Teskari' : 'Normal';
}

function setValue(def, v) {
  if (def.test) test.speedKmh = v; else profile[def.key] = v;
  const r = rows.get(def.key);
  r.input.value = v;
  r.output.textContent = fmt(def, v);
  if (def.key === 'length' || def.key === 'lift') { refit(); rebuildLights(); }
  if (!def.test) saveDraftSoon();
}

// ---------- Tab, yashirish, sinov tugmalari ----------
document.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
  document.querySelectorAll('[data-tabpanel]').forEach((p) => { p.hidden = p.dataset.tabpanel !== btn.dataset.tab; });
}));

$('fold').addEventListener('click', () => {
  const folded = $('panel').classList.toggle('is-folded');
  $('fold').textContent = folded ? 'Ko‘rsatish' : 'Yashirish';
  $('fold').setAttribute('aria-expanded', String(!folded));
});

$('flip').addEventListener('click', () => {
  profile.rotate = profile.rotate === 180 ? 0 : 180;
  $('flip').textContent = profile.rotate === 180 ? 'Teskari' : 'Normal';
  refit();
  saveDraftSoon();
});
$('demo').addEventListener('change', (e) => { test.demo = e.target.checked; });
$('guideChk').addEventListener('change', (e) => { $('guides').classList.toggle('is-on', e.target.checked); });
$('guides').classList.add('is-on');
$('reset').addEventListener('click', () => {
  if (!confirm('Bu mashinaning hamma sozlamalari standart qiymatga qaytariladi. Davom etasizmi?')) return;
  Object.assign(profile, CAR_DEFAULTS);
  syncControls();
  refit();
  saveDraftSoon();
});

// ---------- Chiroqlar ----------
const LIGHT_ROWS = [
  { key: 'x', label: 'Chapga ↔ o‘ngga', min: -1.6, max: 1.6, step: 0.02, unit: 'm' },
  { key: 'y', label: 'Balandligi', min: 0, max: 2.5, step: 0.02, unit: 'm' },
  { key: 'z', label: 'Orqaga ↔ oldinga', min: -4, max: 4, step: 0.02, unit: 'm' },
  { key: 'size', label: 'Kattaligi', min: 0.3, max: 3, step: 0.05, unit: '×' },
];
const SWATCHES = ['#ff2a2a', '#ffffff', '#fff2c0', '#ffc933', '#ff8a1f', '#2f7dff', '#9fe7ff', '#2fe07a', '#b04cff', '#ff4fa3'];
const FUNC_SHORT = { brake: 'Tormoz', reverse: 'Orqaga', button: 'Tugma' };
const lightRowEls = new Map();
const curLight = () => (selLight >= 0 ? lights[selLight] : null);

for (const [v, label] of Object.entries(LIGHT_SHAPES)) $('lShape').append(new Option(label, v));
for (const [v, label] of Object.entries(LIGHT_FUNCS)) $('lFunc').append(new Option(label, v));
for (const color of SWATCHES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sw';
  b.style.background = color;
  b.setAttribute('aria-label', `Rang ${color}`);
  b.addEventListener('click', () => { const l = curLight(); if (l) { l.color = color; changeLight(); } });
  $('lSwatches').append(b);
}

function rebuildLights() {
  if (lightsObj) { carTilt.remove(lightsObj.group); lightsObj.dispose(); }
  lightsObj = createCarLights(lights, { length: profile.length, lift: profile.lift });
  carTilt.add(lightsObj.group);
  lightsObj.update(lightPreview);
}

const fmtLight = (def, v) => `${Number(v).toFixed(def.step < 0.1 ? 2 : 1)} ${def.unit}`;
function buildLightRow(def) {
  const row = document.createElement('div');
  row.className = 'row';
  const head = document.createElement('div');
  head.className = 'row-head';
  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = def.label;
  const output = document.createElement('output');
  output.className = 'row-value';
  head.append(label, output);
  const ctl = document.createElement('div');
  ctl.className = 'row-ctl';
  const minus = document.createElement('button');
  minus.type = 'button'; minus.className = 'step'; minus.textContent = '−'; minus.setAttribute('aria-label', `${def.label}: kamaytirish`);
  const plus = document.createElement('button');
  plus.type = 'button'; plus.className = 'step'; plus.textContent = '+'; plus.setAttribute('aria-label', `${def.label}: oshirish`);
  const input = document.createElement('input');
  input.type = 'range'; input.min = def.min; input.max = def.max; input.step = def.step;
  input.setAttribute('aria-label', def.label);
  ctl.append(minus, input, plus);
  row.append(head, ctl);

  const apply = (v) => {
    const l = curLight();
    if (!l) return;
    l[def.key] = clamp(Math.round(v / def.step) * def.step, def.min, def.max);
    input.value = l[def.key];
    output.textContent = fmtLight(def, l[def.key]);
    rebuildLights();
    saveDraftSoon();
  };
  input.addEventListener('input', () => apply(Number(input.value)));
  minus.addEventListener('click', () => { const l = curLight(); if (l) apply(l[def.key] - def.step); });
  plus.addEventListener('click', () => { const l = curLight(); if (l) apply(l[def.key] + def.step); });
  lightRowEls.set(def.key, { def, input, output });
  $('lightRows').append(row);
}
LIGHT_ROWS.forEach(buildLightRow);

function renderLightUI() {
  const list = $('lightList');
  list.textContent = '';
  lights.forEach((l, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lchip' + (i === selLight ? ' is-active' : '');
    const dot = document.createElement('i');
    dot.style.background = l.color;
    chip.append(dot, document.createTextNode(`${i + 1}. ${LIGHT_SHAPES[l.shape]} · ${FUNC_SHORT[l.func]}`));
    chip.addEventListener('click', () => { selLight = i; renderLightUI(); });
    list.append(chip);
  });
  const l = curLight();
  $('lightForm').hidden = !l;
  $('lightEmpty').hidden = lights.length > 0;
  $('lightDel').disabled = !l;
  if (!l) return;
  $('lShape').value = l.shape;
  $('lFunc').value = l.func;
  $('lColor').value = l.color;
  $('lMirror').checked = !!l.mirror;
  for (const { def, input, output } of lightRowEls.values()) { input.value = l[def.key]; output.textContent = fmtLight(def, l[def.key]); }
  [...$('lSwatches').children].forEach((b, i) => b.classList.toggle('is-active', SWATCHES[i] === l.color));
}
function changeLight() {
  rebuildLights();
  renderLightUI();
  saveDraftSoon();
}

$('lightAdd').addEventListener('click', () => {
  if (lights.length >= MAX_LIGHTS) { toast(`Eng ko‘pi bilan ${MAX_LIGHTS} ta chiroq`); return; }
  lights.push(normalizeLight({}));
  selLight = lights.length - 1;
  changeLight();
});
$('lightDel').addEventListener('click', () => {
  if (selLight < 0) return;
  lights.splice(selLight, 1);
  selLight = Math.min(selLight, lights.length - 1);
  changeLight();
});
$('lShape').addEventListener('change', (e) => { const l = curLight(); if (l) { l.shape = e.target.value; changeLight(); } });
$('lFunc').addEventListener('change', (e) => {
  const l = curLight();
  if (!l) return;
  const old = LIGHT_FUNC_DEFAULTS[l.func], next = LIGHT_FUNC_DEFAULTS[e.target.value];
  if (l.color === old.color) l.color = next.color;          // tegilmagan rang va joy yangi vazifaga mos taklif qilinadi
  if (Math.abs(l.z - old.z) < 0.01) l.z = next.z;
  l.func = e.target.value;
  changeLight();
});
$('lColor').addEventListener('input', (e) => { const l = curLight(); if (l) { l.color = e.target.value.toLowerCase(); rebuildLights(); saveDraftSoon(); renderLightUI(); } });
$('lMirror').addEventListener('change', (e) => { const l = curLight(); if (l) { l.mirror = e.target.checked ? 1 : 0; changeLight(); } });
for (const [id, key] of [['pvBrake', 'brake'], ['pvReverse', 'reverse'], ['pvButton', 'button']]) {
  $(id).addEventListener('change', (e) => { lightPreview[key] = e.target.checked; if (lightsObj) lightsObj.update(lightPreview); });
}

// ---------- Model ----------
function refit() {
  if (!modelScene) return;
  if (fitted) carTilt.remove(fitted);
  fitted = fitCarModel(modelScene, profile);
  carTilt.add(fitted);
}

async function selectCar(entry) {
  const token = ++loadToken;
  carEntry = entry;
  const { lights: draftLights, ...draftNums } = loadCarDraft(entry.name);
  Object.assign(profile, CAR_DEFAULTS, pickProfile(entry), draftNums);
  lights = (draftLights || entry.lights || []).map((l) => ({ ...l }));
  selLight = lights.length ? 0 : -1;
  rebuildLights();
  renderLightUI();
  syncControls();
  document.querySelectorAll('#cars .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.name === entry.name));

  if (fitted) { carTilt.remove(fitted); fitted = null; }
  if (modelScene) { disposeModel(modelScene); modelScene = null; }

  $('loading').hidden = false;
  $('loadingBar').style.width = '6%';
  try {
    const model = await loadCarScene(entry, (p) => { $('loadingBar').style.width = `${Math.round(6 + p * 94)}%`; });
    if (token !== loadToken) { disposeModel(model); return; }
    modelScene = model;
    refit();
  } catch (err) {
    if (token !== loadToken) return;
    console.warn('Mashina yuklanmadi:', err);
    toast(`Model yuklanmadi: ${entry.file}`, 4000);
  } finally {
    if (token === loadToken) $('loading').hidden = true;
  }
}

// ---------- Qoralama va saqlash ----------
let draftTimer = 0;
function saveDraftNow() {
  clearTimeout(draftTimer);
  if (carEntry) saveCarDraft(carEntry.name, { ...pickProfile(profile), lights });
}
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 300);
}
addEventListener('pagehide', saveDraftNow);

// "Sinash": shu mashina bilan o'yinni qoralama sozlamalari bilan ochadi
$('test').addEventListener('click', () => {
  saveDraftNow();
  if (carEntry) saveSelectedCarName(carEntry.name);
});

// "Saqlash": car.txt matnini saqlash oynasida ko'rsatadi (nusxalash / yuklab olish). Ro'yxat sahifa ochilganda car.txt dan o'qilgan,
// faqat shu mashinaning qatorlari yangilanadi, boshqa mashinalar o'zgarmaydi.
let allCars = [];
function saveCarFile() {
  if (!carEntry) return;
  Object.assign(carEntry, pickProfile(profile), { lights: lights.map((l) => ({ ...l })) });   // carEntry allCars ichidagi yozuv
  showSaveDialog({ name: 'car.txt', text: serializeCarList(allCars), type: 'text/plain', steps: [
    'GitHub’da omboringizni oching va car.txt faylini tanlang.',
    'Qalam belgisini (Edit) bosing, ichidagi hamma matnni o‘chiring va nusxalangan matnni yopishtiring.',
    'Commit changes ni bosing. 1-2 daqiqadan keyin hamma yangi sozlamani ko‘radi.',
  ] });
}
$('save').addEventListener('click', () => { saveDraftNow(); saveCarFile(); });

// ---------- O'yin ekrani chegarasi (o'yindagi nisbatda) ----------
let rect = { x: 0, y: 0, w: 100, h: 100 };
function layoutFrame() {
  const r = $('stage').getBoundingClientRect();
  const aspect = innerWidth / innerHeight;        // o'yin butun ekranda ochiladi
  let w = r.width - 8, h = w / aspect;
  if (h > r.height - 8) { h = r.height - 8; w = h * aspect; }
  const x = r.left + (r.width - w) / 2;
  const y = r.top + (r.height - h) / 2;
  rect = { x, y, w, h };
  Object.assign($('frame').style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  layoutFrame();
}
addEventListener('resize', resize);
new ResizeObserver(layoutFrame).observe($('stage'));
resize();

// ---------- Sikl ----------
function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
const desired = new THREE.Vector3();
let time = 0, last = performance.now(), camHeading = 0, roll = 0, lastAspect = 0;

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;

  // Namoyish: mashina o'ngga-chapga burilib turadi (o'yindagi kamera va engashish qoidalari bilan)
  const carHeading = test.demo ? 0.6 * Math.sin(time * 0.9) : 0;
  const steer = test.demo ? -Math.cos(time * 0.9) : 0;
  const speed = Math.max(test.speedKmh / 3.6, test.demo ? 15 : 0);
  carRoot.rotation.y = carHeading;

  camHeading = test.demo ? lerpAngle(camHeading, carHeading, 1 - Math.exp(-dt * profile.follow * 0.56)) : carHeading;
  const pose = cameraPose(profile, 0, 0, camHeading, speed, 0);
  desired.set(pose.px, pose.py, pose.pz);
  if (test.demo) camera.position.lerp(desired, 1 - Math.exp(-dt * profile.follow));
  else camera.position.copy(desired);
  camera.lookAt(pose.lx, pose.ly, pose.lz);
  camera.fov = pose.fov;

  const rollTarget = clamp(-steer * clamp(speed / 20, 0, 1) * 0.05, -0.05, 0.05) * profile.tilt;
  roll += (rollTarget - roll) * Math.min(1, dt * 6);
  carTilt.rotation.set(0, 0, roll);

  // Faqat o'yin ekrani chegarasi ichiga chizamiz
  const aspect = rect.w / rect.h;
  if (Math.abs(aspect - lastAspect) > 1e-4) { camera.aspect = aspect; lastAspect = aspect; }
  camera.updateProjectionMatrix();

  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const gy = innerHeight - (rect.y + rect.h);
  renderer.setViewport(rect.x, gy, rect.w, rect.h);
  renderer.setScissor(rect.x, gy, rect.w, rect.h);
  renderer.render(scene, camera);
});

// ---------- Ishga tushirish ----------
(async function init() {
  syncControls();
  const cars = await fetchCarList();
  allCars = cars;
  if (!cars.length) {
    toast('car.txt topilmadi yoki bo‘sh', 4000);
    return;
  }
  for (const car of cars) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.name = car.name;
    chip.textContent = car.name;
    chip.addEventListener('click', () => {
      if (carEntry && carEntry.name === car.name) return;
      saveDraftNow();
      selectCar(car);
    });
    $('cars').append(chip);
  }
  const wanted = new URLSearchParams(location.search).get('car') || loadSelectedCarName();
  selectCar(cars.find((c) => c.name === wanted) || cars[0]);
})();
