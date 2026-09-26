import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchAirportList, loadSelectedAirportName, saveSelectedAirportName, AIRPORT_KINDS } from './data.js';
import { loadAirportModel, makeEnvironment, disposeModel } from './models.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', '<p class="fatal">Brauzeringiz 3D (WebGL) ni qo‘llamayapti.</p>');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

// ---------- Sahna: qorong'i maydon, aylanib turgan samolyot/vertolyot ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#20242d');
scene.fog = new THREE.Fog('#20242d', 14, 32);
scene.environment = makeEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(6.2, 2.4, 7.2);

const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(5, 8, 4);
scene.add(key, new THREE.HemisphereLight(0xdfeaff, 0x20242d, 0.6));

const floor = new THREE.Mesh(
  new THREE.CylinderGeometry(4.6, 4.6, 0.1, 64),
  new THREE.MeshStandardMaterial({ color: '#2b313d', roughness: 0.85, metalness: 0.1 }),
);
floor.position.y = -0.05;
scene.add(floor);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(4.3, 4.45, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffc933' }),
);
ring.position.y = 0.006;
scene.add(ring);

const stage = new THREE.Group();
scene.add(stage);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.7, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.6;
controls.addEventListener('start', () => { controls.autoRotate = false; });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- Ro'yxat ----------
const list = $('list');
const nameEl = $('airName');
const stateEl = $('airState');
const pickBtn = $('pick');
const loading = $('loading');

let items = [];
let shown = null;        // hozir ko'rsatilayotgan yozuv
let current = null;      // sahnadagi model
let token = 0;
const saved = loadSelectedAirportName();
let savedNow = saved;

function refreshUI() {
  nameEl.textContent = shown ? `${AIRPORT_KINDS[shown.kind] || shown.kind}: ${shown.name}` : 'Samolyot/vertolyot topilmadi';
  list.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('is-active', shown && chip.dataset.name === shown.name);
    chip.classList.toggle('is-saved', chip.dataset.name === savedNow);
  });
}

async function show(item) {
  const mine = ++token;
  shown = item;
  pickBtn.disabled = true;
  stateEl.textContent = '';
  if (current) { stage.remove(current); disposeModel(current); current = null; }
  refreshUI();

  loading.hidden = false;
  $('loadingBar').style.width = '6%';
  try {
    const model = await loadAirportModel(item, (p) => { $('loadingBar').style.width = `${Math.round(6 + p * 94)}%`; });
    if (mine !== token) { disposeModel(model); return; }
    stage.add(model);
    current = model;
    pickBtn.disabled = false;
    stateEl.textContent = item.name === savedNow ? 'Hozir tanlangan' : '';
  } catch (err) {
    if (mine !== token) return;
    console.warn('Samolyot/vertolyot yuklanmadi:', err);
    stateEl.textContent = `Model yuklanmadi: ${item.file}`;
  } finally {
    if (mine === token) loading.hidden = true;
  }
}

pickBtn.addEventListener('click', () => {
  if (!shown) return;
  if (saveSelectedAirportName(shown.name)) {
    savedNow = shown.name;
    location.href = 'index.html';
  } else {
    stateEl.textContent = 'Saqlab bo‘lmadi: brauzer xotirasi yopiq';
  }
});

(async function init() {
  items = await fetchAirportList();
  if (!items.length) {
    nameEl.textContent = 'Samolyot/vertolyot topilmadi';
    stateEl.textContent = 'airport.txt fayli topilmadi yoki bo‘sh';
    return;
  }
  for (const item of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.name = item.name;
    chip.innerHTML = `<span class="chip-kind">${AIRPORT_KINDS[item.kind] || item.kind}</span>${item.name}`;
    chip.addEventListener('click', () => { if (!shown || shown.name !== item.name) show(item); });
    list.append(chip);
  }
  show(items.find((a) => a.name === saved) || items[0]);
})();
