import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchAirportList, AIRPORT_DEFAULTS, AIRPORT_KINDS, loadAirportDraft, saveAirportDraft, serializeAirportList } from './data.js';
import { loadAirportScene, fitCarModel } from './models.js';
import { showSaveDialog } from './savefile.js';

const $ = (id) => document.getElementById(id);
const picker = $('picker');
const tools = $('tools');
const status = $('status');
const lengthValue = $('lengthValue');
const rotValue = $('rotValue');
const canvas = $('preview');

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
}

function rebuildPreview() {
  if (!rawScene) return;
  previewGroup.clear();
  const root = fitCarModel(rawScene, profile);   // qayta yuklamasdan, faqat qayta o'lchaydi/buradi
  previewGroup.add(root);
  refreshValues();
}

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

$('smallerBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.length = Math.max(2, Math.round((profile.length - 0.5) * 10) / 10);
  rebuildPreview();
});
$('biggerBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.length = Math.min(40, Math.round((profile.length + 0.5) * 10) / 10);
  rebuildPreview();
});
$('rotBtn').addEventListener('click', () => {
  if (!profile) return;
  profile.rotate = (Math.round(profile.rotate) + 90) % 360;
  rebuildPreview();
});
$('saveBtn').addEventListener('click', () => {
  if (!current || !profile) return;
  saveAirportDraft(current.name, { length: profile.length, rotate: profile.rotate });
  Object.assign(current, { length: profile.length, rotate: profile.rotate });   // current - items ichidagi o'sha yozuv
  status.textContent = `Saqlandi: ${current.name} (${profile.length.toFixed(1)} m, ${Math.round(profile.rotate)}°)`;
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
