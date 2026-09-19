import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CATALOG, GROUPS, TINTS, ZONE_SIZE, HALF, MAX_OBJECTS, KEYS,
  loadSettings, loadZone, saveZone, defaultZone, normalizeObject, isValidZone, fetchSharedZone,
  makeFootprint, collideCircle, randomTint,
} from './data.js';
import { getGeometry, getMaterial, loadCity } from './models.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();

// ---------- Sahna ----------
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', '<p class="fatal">Brauzeringiz 3D (WebGL) ni qo‘llamayapti.</p>');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9d0ea');
const camera = new THREE.PerspectiveCamera(50, 1, 1, 1500);
const HOME_POS = new THREE.Vector3(0, 120, 95);
camera.position.copy(HOME_POS);

scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7a55, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.2);
sun.position.set(60, 120, 40);
scene.add(sun);

const outer = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#5f8a49' }),
);
outer.position.y = -0.05;
scene.add(outer);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#6f9a55' }),
);
ground.position.y = 0.005;
scene.add(ground);

const grid = new THREE.GridHelper(ZONE_SIZE, ZONE_SIZE / 6, 0x2f5f3a, 0x437a45);
grid.position.y = 0.03;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

const border = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-HALF, 0.06, -HALF), new THREE.Vector3(HALF, 0.06, -HALF),
    new THREE.Vector3(HALF, 0.06, HALF), new THREE.Vector3(-HALF, 0.06, HALF),
  ]),
  new THREE.LineBasicMaterial({ color: 0xffc933 }),
);
scene.add(border);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 12;
controls.maxDistance = 330;
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Holat ----------
const entries = [];          // { id, data, mesh }
let nextId = 1;
let selectedId = null;
let helper = null;
let tool = 'place';
let currentType = 'house_small';
let placeQuarter = 0;        // qo'yiladigan uy/yo'l burilishi: 0..3 * 90°
let snapSize = 2;
const undoStack = [];
let dirty = false;

// ---------- Yordamchi ----------
const clampZone = (v) => Math.max(-HALF, Math.min(HALF, v));
const snapV = (v) => (snapSize > 0 ? Math.round(v / snapSize) * snapSize : v);
const getEntry = (id) => entries.find((e) => e.id === id) || null;

let toastTimer = 0;
function toast(text, ms = 2000) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function currentZone() {
  return { v: 1, size: ZONE_SIZE, objects: entries.map((e) => ({ ...e.data })) };
}
let saveTimer = 0;
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(false), 400);
}
function saveNow(showToast) {
  clearTimeout(saveTimer);
  const ok = saveZone(currentZone());
  if (ok) dirty = false;
  if (showToast) toast(ok ? 'Saqlandi' : 'Saqlab bo‘lmadi: brauzer xotirasi yopiq yoki to‘lgan');
}
addEventListener('pagehide', () => { if (dirty) saveNow(false); });

function updateStatus() {
  const n = entries.filter((e) => e.data.t !== 'spawn').length;
  $('count').textContent = `${n} ta obyekt`;
  $('undo').disabled = undoStack.length === 0;
}

// ---------- Obyektlar ----------
function applyTransform(mesh, data) {
  mesh.position.set(data.x, 0, data.z);
  mesh.rotation.set(0, data.r, 0);
  mesh.scale.setScalar(data.s);
}

function addEntry(data) {
  const def = CATALOG[data.t];
  const mesh = new THREE.Mesh(getGeometry(data.t), getMaterial(def.kind, data.c));
  applyTransform(mesh, data);
  const entry = { id: nextId++, data, mesh };
  mesh.userData.id = entry.id;
  scene.add(mesh);
  entries.push(entry);
  updateStatus();
  return entry;
}

function removeEntry(entry) {
  if (selectedId === entry.id) selectEntry(null);
  scene.remove(entry.mesh);
  entries.splice(entries.indexOf(entry), 1);
  updateStatus();
}

function refreshEntry(entry) {
  applyTransform(entry.mesh, entry.data);
  entry.mesh.material = getMaterial(CATALOG[entry.data.t].kind, entry.data.c);
  if (helper && selectedId === entry.id) helper.update();
  updateSelInfo();
}

function replaceAll(list) {
  selectEntry(null);
  for (const e of entries.slice()) removeEntry(e);
  for (const o of list) addEntry(normalizeObject(o));
}

// Bekor qilish
function pushUndo() {
  undoStack.push(JSON.stringify(entries.map((e) => e.data)));
  if (undoStack.length > 40) undoStack.shift();
  updateStatus();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  replaceAll(JSON.parse(snap));
  scheduleSave();
  updateStatus();
}
$('undo').addEventListener('click', undo);

// ---------- Tanlash ----------
function selectEntry(id) {
  selectedId = id;
  if (helper) { scene.remove(helper); helper.geometry.dispose(); helper = null; }
  const entry = id != null ? getEntry(id) : null;
  if (entry) {
    helper = new THREE.BoxHelper(entry.mesh, 0xffc933);
    helper.material.depthTest = false;
    helper.renderOrder = 999;
    scene.add(helper);
  } else {
    selectedId = null;
  }
  updateSelInfo();
}
function updateSelInfo() {
  const entry = selectedId != null ? getEntry(selectedId) : null;
  $('selInfo').textContent = entry
    ? `${CATALOG[entry.data.t].label}: x ${Math.round(entry.data.x)}, z ${Math.round(entry.data.z)}, kattalik ×${entry.data.s.toFixed(2)}`
    : 'Obyektni tanlash uchun unga bosing. Tanlangach barmoq bilan surib qo‘ying.';
  $('selActions').querySelectorAll('button').forEach((b) => { b.disabled = !entry; });
}

// ---------- Qo'yish ----------
function placeAt(x, z) {
  if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
  const def = CATALOG[currentType];
  const isTree = def.kind === 'tree';
  pushUndo();
  if (currentType === 'spawn') {
    const old = entries.find((e) => e.data.t === 'spawn');
    if (old) removeEntry(old);
  }
  addEntry(normalizeObject({
    t: currentType,
    x: clampZone(snapV(x)),
    z: clampZone(snapV(z)),
    r: isTree ? Math.random() * Math.PI * 2 : (placeQuarter * Math.PI) / 2,
    s: isTree ? 0.85 + Math.random() * 0.5 : 1,
    c: randomTint(currentType),
  }));
  scheduleSave();
}

// Palitra
const SWATCH = { house: '#e9dcc3', tree: '#3b8a58', road: '#3a3f47', spawn: '#ffc933' };
const palette = $('palette');
for (const group of GROUPS) {
  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = group;
  palette.append(label);
  for (const [type, def] of Object.entries(CATALOG)) {
    if (def.group !== group) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.type = type;
    const swatch = document.createElement('i');
    swatch.style.background = SWATCH[def.kind];
    const text = document.createElement('span');
    text.textContent = def.label;
    btn.append(swatch, text);
    btn.addEventListener('click', () => { currentType = type; markActiveChip(); });
    palette.append(btn);
  }
}
function markActiveChip() {
  palette.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.type === currentType));
}
markActiveChip();

$('placeRot').addEventListener('click', () => {
  placeQuarter = (placeQuarter + 1) % 4;
  $('placeRot').textContent = `Burish: ${placeQuarter * 90}°`;
});

// ---------- Asboblar ----------
function setTool(next) {
  tool = next;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== next; });
  if (next !== 'select') selectEntry(null);
  // Kamera rejimida bir barmoq aylantiradi; boshqa rejimlarda bir barmoq obyektlar uchun
  const rotate = next === 'camera';
  controls.touches.ONE = rotate ? THREE.TOUCH.ROTATE : null;
  controls.mouseButtons.LEFT = rotate ? THREE.MOUSE.ROTATE : null;
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
setTool('place');

$('resetView').addEventListener('click', () => {
  camera.position.copy(HOME_POS);
  controls.target.set(0, 0, 0);
});

// Tanlangan obyekt uchun amallar
function actOnSelected(fn) {
  const entry = getEntry(selectedId);
  if (!entry) return;
  pushUndo();
  fn(entry);
  refreshEntry(entry);
  scheduleSave();
}
$('selActions').addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const entry = getEntry(selectedId);
  if (!entry) return;
  const kind = CATALOG[entry.data.t].kind;
  if (act === 'rotL') actOnSelected((e) => { e.data.r -= Math.PI / 12; });
  else if (act === 'rotR') actOnSelected((e) => { e.data.r += Math.PI / 12; });
  else if (act === 'smaller') actOnSelected((e) => { e.data.s = Math.max(0.4, e.data.s / 1.1); });
  else if (act === 'bigger') actOnSelected((e) => { e.data.s = Math.min(3, e.data.s * 1.1); });
  else if (act === 'tint') actOnSelected((e) => { e.data.c = (e.data.c + 1) % TINTS[kind].length; });
  else if (act === 'dup') {
    if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
    if (entry.data.t === 'spawn') { toast('Boshlanish nuqtasi faqat bitta bo‘ladi'); return; }
    pushUndo();
    const copy = addEntry({ ...entry.data, x: clampZone(entry.data.x + 6), z: clampZone(entry.data.z + 6) });
    selectEntry(copy.id);
    scheduleSave();
  } else if (act === 'del') {
    pushUndo();
    removeEntry(entry);
    scheduleSave();
  }
});

// ---------- Barmoq bilan ishlash ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

function setRay(ev) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
function groundPoint(ev) {
  setRay(ev);
  return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint : null;
}
function pickEntryId(ev) {
  setRay(ev);
  const hits = raycaster.intersectObjects(entries.map((e) => e.mesh), false);
  return hits.length ? hits[0].object.userData.id : null;
}
function moveEntry(entry, x, z) {
  entry.data.x = clampZone(snapV(x));
  entry.data.z = clampZone(snapV(z));
  refreshEntry(entry);
}

const pointers = new Set();
let gesture = null;

canvas.addEventListener('pointerdown', (ev) => {
  pointers.add(ev.pointerId);
  if (pointers.size > 1) { gesture = null; return; }   // ikkinchi barmoq: kamera
  gesture = { sx: ev.clientX, sy: ev.clientY, moved: false, drag: null };
  if (tool === 'select' && selectedId != null && pickEntryId(ev) === selectedId) {
    const gp = groundPoint(ev);
    const entry = getEntry(selectedId);
    if (gp && entry) gesture.drag = { dx: entry.data.x - gp.x, dz: entry.data.z - gp.z, pushed: false };
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!gesture || pointers.size > 1) return;
  if (!gesture.moved && Math.hypot(ev.clientX - gesture.sx, ev.clientY - gesture.sy) > 8) gesture.moved = true;
  if (gesture.drag && gesture.moved) {
    const gp = groundPoint(ev);
    const entry = getEntry(selectedId);
    if (!gp || !entry) return;
    if (!gesture.drag.pushed) { pushUndo(); gesture.drag.pushed = true; }
    moveEntry(entry, gp.x + gesture.drag.dx, gp.z + gesture.drag.dz);
  }
});

function endPointer(ev) {
  const wasSingle = pointers.size === 1;
  pointers.delete(ev.pointerId);
  const g = gesture;
  if (pointers.size === 0) gesture = null;
  if (!g || !wasSingle) return;
  if (g.drag && g.moved) { scheduleSave(); return; }
  if (g.moved || ev.type === 'pointercancel') return;
  if (tool === 'place') {
    const gp = groundPoint(ev);
    if (gp) placeAt(gp.x, gp.z);
  } else if (tool === 'select') {
    selectEntry(pickEntryId(ev));
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Tasodifiy daraxtlar ----------
function plantTrees(count) {
  const feet = entries.map((e) => makeFootprint(e.data)).filter(Boolean);
  const spawnEntry = entries.find((e) => e.data.t === 'spawn');
  pushUndo();
  let planted = 0, tries = 0;
  while (planted < count && tries < count * 25 && entries.length < MAX_OBJECTS) {
    tries++;
    const x = (Math.random() * 2 - 1) * (HALF - 4);
    const z = (Math.random() * 2 - 1) * (HALF - 4);
    if (feet.some((f) => collideCircle(f, x, z, 2.4))) continue;
    if (spawnEntry && Math.hypot(x - spawnEntry.data.x, z - spawnEntry.data.z) < 6) continue;
    const t = Math.random() < 0.5 ? 'tree_pine' : 'tree_round';
    const data = normalizeObject({ t, x, z, r: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.6, c: randomTint(t) });
    addEntry(data);
    feet.push(makeFootprint(data));
    planted++;
  }
  if (planted === 0) undoStack.pop();
  scheduleSave();
  updateStatus();
  toast(planted ? `${planted} ta daraxt ekildi` : 'Bo‘sh joy topilmadi');
}

// ---------- Qo'shimcha oyna ----------
const sheet = $('sheet');
$('more').addEventListener('click', () => { sheet.hidden = false; });
$('closeSheet').addEventListener('click', () => { sheet.hidden = true; });
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });

$('snapSel').addEventListener('change', (e) => { snapSize = Number(e.target.value); });
$('plant').addEventListener('click', () => {
  const n = Math.max(1, Math.min(200, Math.floor(Number($('treeCount').value) || 0)));
  sheet.hidden = true;
  plantTrees(n);
});

$('clearAll').addEventListener('click', () => {
  if (!confirm('Zonadagi hamma obyektlar o‘chiriladi. Davom etasizmi?')) return;
  pushUndo();
  replaceAll([]);
  scheduleSave();
  sheet.hidden = true;
  toast('Zona tozalandi. Qaytarish tugmasi bilan tiklash mumkin');
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(currentZone(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dexo-gta-zona.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const zone = JSON.parse(await file.text());
    if (!isValidZone(zone)) throw new Error('format');
    if (!confirm(`Fayldagi ${zone.objects.length} ta obyekt hozirgi zonani almashtiradi. Davom etasizmi?`)) return;
    pushUndo();
    replaceAll(zone.objects);
    scheduleSave();
    sheet.hidden = true;
    toast('Zona import qilindi');
  } catch {
    toast('Fayl noto‘g‘ri: DEXO GTA zona fayli emas');
  }
});

$('play').addEventListener('click', () => saveNow(false));

// ---------- Umumiy zonani GitHub'ga saqlash (faqat token egasi yoza oladi) ----------
function loadGithub() {
  try { return JSON.parse(localStorage.getItem(KEYS.github)) || {}; } catch { return {}; }
}
function readGithubFields() {
  return {
    owner: $('ghOwner').value.trim(),
    repo: $('ghRepo').value.trim(),
    branch: $('ghBranch').value.trim() || 'main',
    token: $('ghToken').value.trim(),
  };
}
function storeGithub(cfg) {
  try { localStorage.setItem(KEYS.github, JSON.stringify(cfg)); return true; } catch { return false; }
}
{
  const cfg = loadGithub();
  $('ghOwner').value = cfg.owner || '';
  $('ghRepo').value = cfg.repo || '';
  $('ghBranch').value = cfg.branch || 'main';
  $('ghToken').value = cfg.token || '';
}
$('ghSave').addEventListener('click', () => {
  toast(storeGithub(readGithubFields()) ? 'Ulanish saqlandi' : 'Saqlab bo‘lmadi: brauzer xotirasi yopiq');
});

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function ghError(status) {
  if (status === 401) return 'Token noto‘g‘ri yoki muddati tugagan';
  if (status === 403 || status === 404) return 'Ombor nomi yoki token ruxsati noto‘g‘ri (Contents: Read and write kerak)';
  return `GitHub xatosi (${status})`;
}

let publishing = false;
async function publishZone() {
  const cfg = loadGithub();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    sheet.hidden = false;
    toast('Avval GitHub ulanishini to‘ldiring va “Ulanishni saqlash” ni bosing', 3500);
    return;
  }
  if (publishing) return;
  publishing = true;
  toast('Serverga yuborilmoqda…', 10000);
  try {
    const api = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/zone.json`;
    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const content = toBase64(JSON.stringify(currentZone()));
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      let sha;
      const head = await fetch(`${api}?ref=${encodeURIComponent(cfg.branch)}`, { headers, cache: 'no-store' });
      if (head.ok) sha = (await head.json()).sha;
      else if (head.status !== 404) throw Object.assign(new Error('get'), { status: head.status });
      const put = await fetch(api, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Zona yangilandi', content, branch: cfg.branch, ...(sha ? { sha } : {}) }),
      });
      if (put.ok) { toast('Saqlandi. O‘yinchilarga 1-2 daqiqada ko‘rinadi', 3500); return; }
      lastStatus = put.status;
      if (put.status !== 409 && put.status !== 422) break;   // sha eskirgan bo'lsa bir marta qayta urinamiz
    }
    throw Object.assign(new Error('put'), { status: lastStatus });
  } catch (err) {
    toast(err.status ? ghError(err.status) : 'Internet yo‘q yoki GitHub bilan aloqa uzildi', 4000);
  } finally {
    publishing = false;
  }
}

$('save').addEventListener('click', () => {
  saveNow(false);
  publishZone();
});

$('pull').addEventListener('click', async () => {
  const zone = await fetchSharedZone();
  if (!zone) { toast('Serverda zone.json topilmadi'); return; }
  if (!confirm('Hozirgi zona serverdagi zona bilan almashtiriladi. Davom etasizmi?')) return;
  pushUndo();
  replaceAll(zone.objects);
  scheduleSave();
  sheet.hidden = true;
  toast('Serverdagi zona yuklandi');
});

// ---------- Ishga tushirish ----------
const startZone = loadZone() || (await fetchSharedZone()) || defaultZone();
for (const o of startZone.objects) addEntry(normalizeObject(o));
updateStatus();
updateSelInfo();

renderer.setAnimationLoop(() => {
  controls.update();
  if (helper) helper.update();
  renderer.render(scene, camera);
});

if (settings.useCityModel) {
  const box = $('loading');
  box.hidden = false;
  loadCity((p) => { $('loadingBar').style.width = `${Math.round(6 + p * 94)}%`; })
    .then((city) => { scene.add(city); })
    .catch(() => toast('Shahar modeli topilmadi: assets/procedural_city_6.glb'))
    .finally(() => { box.hidden = true; });
}
