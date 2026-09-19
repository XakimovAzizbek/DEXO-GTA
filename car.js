import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchCarList, loadSelectedCarName, saveSelectedCarName } from './data.js';
import { loadCarModel, makeEnvironment, disposeModel } from './models.js';

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

// ---------- Sahna: qorong'i maydon, aylanib turgan mashina ----------
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
controls.maxDistance = 12;
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
const nameEl = $('carName');
const stateEl = $('carState');
const pickBtn = $('pick');
const loading = $('loading');

let cars = [];
let shown = null;        // hozir ko'rsatilayotgan mashina
let current = null;      // sahnadagi model
let token = 0;
const saved = loadSelectedCarName();

function refreshUI() {
  nameEl.textContent = shown ? shown.name : 'Mashina topilmadi';
  list.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('is-active', shown && chip.dataset.name === shown.name);
    chip.classList.toggle('is-saved', chip.dataset.name === savedNow);
  });
}
let savedNow = saved;

async function show(car) {
  const mine = ++token;
  shown = car;
  pickBtn.disabled = true;
  stateEl.textContent = '';
  if (current) { stage.remove(current); disposeModel(current); current = null; }
  refreshUI();

  loading.hidden = false;
  $('loadingBar').style.width = '6%';
  try {
    const model = await loadCarModel(car, (p) => { $('loadingBar').style.width = `${Math.round(6 + p * 94)}%`; });
    if (mine !== token) { disposeModel(model); return; }
    stage.add(model);
    current = model;
    pickBtn.disabled = false;
    stateEl.textContent = car.name === savedNow ? 'Hozir tanlangan' : '';
  } catch (err) {
    if (mine !== token) return;
    console.warn('Mashina yuklanmadi:', err);
    stateEl.textContent = `Model yuklanmadi: ${car.file}`;
  } finally {
    if (mine === token) loading.hidden = true;
  }
}

pickBtn.addEventListener('click', () => {
  if (!shown) return;
  if (saveSelectedCarName(shown.name)) {
    location.href = 'index.html';
  } else {
    stateEl.textContent = 'Saqlab bo‘lmadi: brauzer xotirasi yopiq';
  }
});

(async function init() {
  cars = await fetchCarList();
  if (!cars.length) {
    nameEl.textContent = 'Mashina topilmadi';
    stateEl.textContent = 'car.txt fayli topilmadi yoki bo‘sh';
    return;
  }
  for (const car of cars) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.name = car.name;
    chip.textContent = car.name;
    chip.addEventListener('click', () => { if (!shown || shown.name !== car.name) show(car); });
    list.append(chip);
  }
  show(cars.find((c) => c.name === saved) || cars[0]);
})();
