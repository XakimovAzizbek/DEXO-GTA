import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchAirportList, AIRPORT_DEFAULTS, AIRPORT_KINDS, loadAirportDraft, saveAirportDraft, serializeAirportList } from './data.js';
import { loadAirportScene, fitCarModel, buildRocketModel } from './models.js';
import { showSaveDialog } from './savefile.js';

const $ = (id) => document.getElementById(id);
const picker = $('picker');
const tools = $('tools');
const status = $('status');
const lengthValue = $('lengthValue');
const rotValue = $('rotValue');
const canvas = $('preview');
const speedValue = $('speedValue');
const speedHint = $('speedHint');
const rocketBtn = $('rocketBtn');
const rocketTools = $('rocketTools');
const rocketValue = $('rocketValue');

// O'yindagi asosiy tezliklar (m/s) - ko'rsatma uchun. Ko'paytirgich shunga ko'paytiriladi.
const BASE_SPEED = { airplane: 55, helicopter: 24 };
const SAVE_KEYS = ['length', 'rotate', 'speed', 'rocket', 'rocketx', 'rockety', 'rocketz', 'rocketsize'];

// ---------- 3D preview ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd9ee');
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(10, 6, 12);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const hemi = new THREE.HemisphereLight(0xffffff, 0x5b6a4c, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(6, 10, 4);
scene.add(sun);

const grid = new THREE.GridHelper(60, 30, '#7c8b64', '#8fa373');
scene.add(grid);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 80;
controls.update();

const previewGroup = new THREE.Group();
scene.add(previewGroup);

function resize() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let spinNodes = [];
renderer.setAnimationLoop(() => {
  controls.update();
  for (const o of spinNodes) o.rotation.y += 0.28;   // parrak/rotor - ko'rish uchun sekin aylanadi
  renderer.render(scene, camera);
});

// ---------- Tanlangan yozuv holati ----------
let items = [];
let current = null;     // tanlangan airport.txt yozuvi
let profile = null;     // {...AIRPORT_DEFAULTS, ...current, ...qoralama}
let rawScene = null;    // GLB (hali o'lchamlanmagan) - qayta yuklamasdan qayta o'lchash uchun

function renderPicker() {
  picker.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `ed-card${current && current.name === item.name ? ' is-selected' : ''}`;
    card.textContent = `${AIRPORT_KINDS[item.kind] || item.kind}: ${item.name}`;
    card.addEventListener('click', () => selectEntry(item));
    picker.appendChild(card);
  }
}

function refreshValues() {
  lengthValue.textContent = `${profile.length.toFixed(1)} m`;
  rotValue.textContent = `${Math.round(profile.rotate) % 360}°`;
  const k = Number(profile.speed) || 1;
  speedValue.textContent = `×${k.toFixed(1)}`;
  const base = BASE_SPEED[current && current.kind] || 55;
  speedHint.textContent = `Eng yuqori tezlik: ~${Math.round(base * k * 3.6)} km/soat`;
  const on = !!Number(profile.rocket);
  rocketBtn.textContent = on ? '🚀 Raketa: yoqilgan' : '🚀 Raketa: o‘chiq';
  rocketBtn.classList.toggle('is-on', on);
  rocketTools.hidden = !on;
  rocketValue.textContent = `Joyi: o‘ng ${profile.rocketx.toFixed(2)} m · balandlik ${profile.rockety.toFixed(2)} m · old ${profile.rocketz.toFixed(2)} m · uzunligi ${profile.rocketsize.toFixed(1)} m`;
}

// ---------- Raketa: qo'lda surish ----------
let rocketMeshes = [];   // [o'ng raketa, chap (aks etgan) raketa]
function addRocketMesh(mirror) {
  const g = new THREE.Group();
  g.userData.mirror = mirror;
  g.add(buildRocketModel(profile.rocketsize));
  const hit = new THREE.Mesh(                     // ko'rinmas katta "tutqich" - barmoq bilan ushlash oson bo'lsin
    new THREE.SphereGeometry(Math.max(0.7, profile.rocketsize * 0.6), 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  g.add(hit);
  previewGroup.add(g);
  rocketMeshes.push(g);
}
function buildRockets() {
  rocketMeshes = [];
  if (!Number(profile.rocket)) return;
  addRocketMesh(false);
  if (Math.abs(profile.rocketx) > 0.05) addRocketMesh(true);
  placeRockets();
}
function placeRockets() {
  for (const g of rocketMeshes) {
    g.position.set(g.userData.mirror ? -profile.rocketx : profile.rocketx, profile.rockety, profile.rocketz);
  }
}
function rocketDefaultSpot() {                    // birinchi yoqilganda: qanot tagiga taxminan
  const box = new THREE.Box3().setFromObject(previewGroup);
  if (box.isEmpty()) return;
  const h = box.max.y - box.min.y, w = box.max.x - box.min.x;
  profile.rocketx = Math.round(w * 0.22 * 20) / 20;
  profile.rockety = Math.round((box.min.y + h * 0.32) * 20) / 20;
  profile.rocketz = 0;
}

function rebuildPreview() {
  if (!rawScene) return;
  previewGroup.clear();
  const root = fitCarModel(rawScene, profile);   // qayta yuklamasdan, faqat qayta o'lchaydi/buradi
  previewGroup.add(root);
  buildRockets();
  refreshValues();
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
let drag = null;
function aimRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
canvas.addEventListener('pointerdown', (e) => {
  if (!profile || !rocketMeshes.length) return;
  aimRay(e);
  const hit = raycaster.intersectObjects(rocketMeshes, true)[0];
  if (!hit) return;                               // raketaga tegmasa - kamera odatdagidek aylanadi
  let top = hit.object;
  while (top && !rocketMeshes.includes(top)) top = top.parent;
  if (!top) return;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(_dir).clone(), hit.point);
  drag = { top, plane, offset: hit.point.clone().sub(top.position) };
  controls.enabled = false;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  aimRay(e);
  if (!raycaster.ray.intersectPlane(drag.plane, _p)) return;
  _p.sub(drag.offset);
  const lim = profile.length * 0.7;
  const q = (v) => Math.round(Math.max(-lim, Math.min(lim, v)) * 20) / 20;   // 5 sm qadam
  profile.rocketx = q(drag.top.userData.mirror ? -_p.x : _p.x);
  profile.rockety = Math.max(0, q(_p.y));
  profile.rocketz = q(_p.z);
  placeRockets();
  refreshValues();
});
function endDrag() { if (!drag) return; drag = null; controls.enabled = true; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

rocketBtn.addEventListener('click', () => {
  if (!profile) return;
  profile.rocket = Number(profile.rocket) ? 0 : 1;
  if (profile.rocket && !profile.rocketx && !profile.rockety && !profile.rocketz) rocketDefaultSpot();
  rebuildPreview();
});
document.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
  if (!profile || !Number(profile.rocket)) return;
  const key = `rocket${b.dataset.nudge}`;
  profile[key] = Math.round((profile[key] + Number(b.dataset.d)) * 100) / 100;
  if (key === 'rockety') profile[key] = Math.max(0, profile[key]);
  if (key === 'rocketx' && rocketMeshes.length !== (Math.abs(profile.rocketx) > 0.05 ? 2 : 1)) buildRockets();
  placeRockets();
  refreshValues();
}));
$('rkSmaller').addEventListener('click', () => {
  if (!profile) return;
  profile.rocketsize = Math.max(0.6, Math.round((profile.rocketsize - 0.2) * 10) / 10);
  rebuildPreview();
});
$('rkBigger').addEventListener('click', () => {
  if (!profile) return;
  profile.rocketsize = Math.min(8, Math.round((profile.rocketsize + 0.2) * 10) / 10);
  rebuildPreview();
});

// ---------- Tezlik ----------
$('slowerBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.speed = Math.max(0.5, Math.round(((Number(profile.speed) || 1) - 0.1) * 10) / 10);
  refreshValues();
});
$('fasterBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.speed = Math.min(3, Math.round(((Number(profile.speed) || 1) + 0.1) * 10) / 10);
  refreshValues();
});

async function selectEntry(item) {
  current = item;
  status.textContent = '';
  tools.hidden = true;
  renderPicker();

  const draft = loadAirportDraft(item.name);
  profile = { ...AIRPORT_DEFAULTS, ...item, ...draft };

  status.textContent = `${item.name} yuklanmoqda…`;
  try {
    rawScene = await loadAirportScene(profile, () => {});
    spinNodes = [];
    rawScene.traverse((o) => { if (/rotor|propellar|propeller|\bblade\b|\bprop\b/i.test(o.name || '')) spinNodes.push(o); });
    rebuildPreview();
    tools.hidden = false;
    status.textContent = '';
    resize();
  } catch (err) {
    console.warn('Model yuklanmadi:', err);
    status.textContent = `${item.name} uchun GLB fayl topilmadi (avval airport/, keyin cars/, keyin bosh papkadan qidiriladi).`;
  }
}

// Samolyot kattalashsa/kichraysa raketa ham o'z joyida qolsin (joyi mutanosib siljiydi).
function setLength(next) {
  const k = next / profile.length;
  profile.rocketx = Math.round(profile.rocketx * k * 20) / 20;
  profile.rockety = Math.round(profile.rockety * k * 20) / 20;
  profile.rocketz = Math.round(profile.rocketz * k * 20) / 20;
  profile.length = next;
  rebuildPreview();
}
$('smallerBtn').addEventListener('click', () => {
  if (!profile) return;
  setLength(Math.max(2, Math.round((profile.length - 0.5) * 10) / 10));
});
$('biggerBtn').addEventListener('click', () => {
  if (!profile) return;
  setLength(Math.min(40, Math.round((profile.length + 0.5) * 10) / 10));
});
$('rotBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.rotate = (Math.round(profile.rotate) + 90) % 360;
  rebuildPreview();
});
$('saveBtn').addEventListener('click', () => {
  if (!current || !profile) return;
  const data = {};
  for (const key of SAVE_KEYS) data[key] = profile[key];
  saveAirportDraft(current.name, data);
  Object.assign(current, data);   // current - items ichidagi o'sha yozuv
  status.textContent = `Saqlandi: ${current.name} (${profile.length.toFixed(1)} m, ${Math.round(profile.rotate)}°, tezlik ×${(Number(profile.speed) || 1).toFixed(1)}${Number(profile.rocket) ? ', raketa bor' : ''})`;
  showSaveDialog({
    name: 'airport.txt',
    text: serializeAirportList(items),
    type: 'text/plain',
    steps: [
      'GitHub’da omboringizni oching va airport.txt faylini tanlang.',
      'Qalam belgisini (Edit) bosing, ichidagi hamma matnni o‘chiring va nusxalangan matnni yopishtiring.',
      'Commit changes ni bosing. 1-2 daqiqadan keyin hamma yangi sozlamani ko‘radi.',
    ],
  });
});

// ---------- Ishga tushirish ----------
(async () => {
  items = await fetchAirportList();
  if (!items.length) {
    picker.innerHTML = '<p class="ed-hint">airport.txt topilmadi yoki bo‘sh. Avval samolyot/vertolyot qo‘shing.</p>';
    return;
  }
  renderPicker();
  resize();
  await selectEntry(items[0]);
})();
