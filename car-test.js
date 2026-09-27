import * as THREE from 'three';
import { fetchCarList, loadSelectedCarName, loadCarDraft } from './data.js';
import { loadCarModel, makeEnvironment, disposeModel } from './models.js';
import { createCarLights } from './lights.js';

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

// ---------- Sahna: oddiy ko'rgazma maydoni ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#20242d');
scene.fog = new THREE.Fog('#20242d', 14, 34);
scene.environment = makeEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(6.4, 2.3, 7.4);
camera.lookAt(0, 0.8, 0);

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

// Mashina shu guruh ichida - ekranni surganda aynan shu aylanadi (kamera emas).
const carRoot = new THREE.Group();
scene.add(carRoot);
let current = null;
let currentLights = null;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

// ---------- Ekranni surganda mashinani aylantirish ----------
let dragging = false, lastX = 0, spin = 0;
canvas.addEventListener('pointerdown', (ev) => {
  dragging = true;
  lastX = ev.clientX;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const dx = ev.clientX - lastX;
  lastX = ev.clientX;
  spin = dx * 0.012;
  carRoot.rotation.y += spin;
});
function endDrag() { dragging = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Barmoqni qo'yib yuborgach ham ozgina inersiya bilan aylanib, asta to'xtaydi - tabiiyroq ko'rinadi.
(function inertia() {
  requestAnimationFrame(inertia);
  if (dragging) return;
  if (Math.abs(spin) < 0.0002) { spin = 0; return; }
  carRoot.rotation.y += spin;
  spin *= 0.94;
})();

// ---------- Qaysi mashina yuklanishi kerakligini aniqlash (car-editor "Sinash" shu yerga yo'naltiradi) ----------
const params = new URLSearchParams(location.search);
const useDraft = params.get('draft') === '1';

(async function init() {
  const cars = await fetchCarList();
  const wanted = params.get('car') || loadSelectedCarName();
  let entry = cars.find((c) => c.name === wanted) || cars[0] || null;
  if (!entry) {
    $('loadingText').textContent = 'Mashina topilmadi.';
    return;
  }
  if (useDraft) entry = { ...entry, ...loadCarDraft(entry.name) };
  $('carName').textContent = entry.name;
  $('carInfo').textContent = `Uzunligi: ${entry.length.toFixed(1)} m · Yerdan balandligi: ${entry.lift.toFixed(2)} m`;

  try {
    const model = await loadCarModel(entry, (p) => { $('loadingBar').style.width = `${Math.round(6 + p * 94)}%`; });
    if (current) disposeModel(current);
    if (currentLights) currentLights.dispose();
    carRoot.add(model);
    current = model;

    // Sozlangan chiroqlar ham (bo'lsa) shu yerda ko'rinsin - hammasini yoqib qo'yamiz, hech biri yashirin qolmasin.
    currentLights = createCarLights(entry.lights, { length: entry.length, lift: entry.lift });
    carRoot.add(currentLights.group);
    currentLights.update({ brake: true, reverse: true, button: true });

    $('loading').hidden = true;
  } catch (err) {
    console.warn('Mashina yuklanmadi:', err);
    $('loadingText').textContent = `Model yuklanmadi: ${entry.file}`;
  }
})();
