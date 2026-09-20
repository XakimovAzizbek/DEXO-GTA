import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CATALOG, GROUPS, TINTS, ZONE_SIZE, HALF, MAX_OBJECTS, MIN_EXTENT, MAX_EXTENT, BOUNDS_STEP, normalizeBounds, RAMP_STEP, RAMP_MAX,
  loadSettings, loadZone, saveZone, defaultZone, normalizeObject, isValidZone, fetchSharedZone,
  makeFootprint, collideCircle, randomTint,
} from './data.js';
import { getGeometry, getMaterial, loadCity } from './models.js';
import { showSaveDialog } from './savefile.js';

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

// Zona chegarasi (markazdan har tomonga masofa). Yer, setka va chegara chizig'i shundan quriladi.
let bounds = normalizeBounds(null);
let groundMesh = null, gridMesh = null, borderMesh = null;
const clampX = (v) => Math.max(-bounds.w, Math.min(bounds.e, v));
const clampZ = (v) => Math.max(-bounds.n, Math.min(bounds.s, v));

function disposeMesh(m) {
  if (!m) return;
  scene.remove(m);
  m.geometry.dispose();
  m.material.dispose();
}
function buildBoundsVisuals() {
  disposeMesh(groundMesh); disposeMesh(gridMesh); disposeMesh(borderMesh);
  const minX = -bounds.w, maxX = bounds.e, minZ = -bounds.n, maxZ = bounds.s;

  groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#6f9a55' }),
  );
  groundMesh.position.set((minX + maxX) / 2, 0.005, (minZ + maxZ) / 2);
  scene.add(groundMesh);

  const pts = [];
  for (let x = Math.ceil(minX / 6) * 6; x <= maxX; x += 6) pts.push(new THREE.Vector3(x, 0.03, minZ), new THREE.Vector3(x, 0.03, maxZ));
  for (let z = Math.ceil(minZ / 6) * 6; z <= maxZ; z += 6) pts.push(new THREE.Vector3(minX, 0.03, z), new THREE.Vector3(maxX, 0.03, z));
  gridMesh = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x437a45, transparent: true, opacity: 0.55 }),
  );
  scene.add(gridMesh);

  borderMesh = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, 0.06, minZ), new THREE.Vector3(maxX, 0.06, minZ),
      new THREE.Vector3(maxX, 0.06, maxZ), new THREE.Vector3(minX, 0.06, maxZ),
    ]),
    new THREE.LineBasicMaterial({ color: 0xffc933 }),
  );
  scene.add(borderMesh);
}
buildBoundsVisuals();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 12;
controls.maxDistance = 950;
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
let placeLevel = 0;          // qo'yiladigan rampaning balandligi (m)
let placeQuarter = 0;        // qo'yiladigan uy/yo'l burilishi: 0..3 * 90°
let snapSize = 2;
const undoStack = [];
let dirty = false;

// ---------- Yordamchi ----------
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
  return { v: 1, size: ZONE_SIZE, bounds: { ...bounds }, objects: entries.map((e) => ({ ...e.data })) };
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
  const mesh = new THREE.Mesh(getGeometry(data.t, data.y || 0), getMaterial(def.kind, data.c));
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
  entry.mesh.geometry = getGeometry(entry.data.t, entry.data.y || 0);   // rampa balandligi o'zgarganda
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
  undoStack.push(JSON.stringify({ o: entries.map((e) => e.data), b: bounds }));
  if (undoStack.length > 40) undoStack.shift();
  updateStatus();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  const state = JSON.parse(snap);
  setBounds(state.b);
  replaceAll(state.o);
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
  const isBoard = !!entry && CATALOG[entry.data.t].kind === 'billboard';
  const isRamp = !!entry && CATALOG[entry.data.t].kind === 'ramp';
  $('selInfo').textContent = entry
    ? `${CATALOG[entry.data.t].label}: x ${Math.round(entry.data.x)}, z ${Math.round(entry.data.z)}, kattalik ×${entry.data.s.toFixed(2)}${isBoard ? `, reklama №${entry.data.c + 1}` : ''}${isRamp ? `, balandlik ${entry.data.y || 0} m` : ''}`
    : 'Obyektni tanlash uchun unga bosing. Tanlangach barmoq bilan surib qo‘ying.';
  $('selActions').querySelectorAll('button').forEach((b) => { b.disabled = !entry; });
  const setDisabled = (act, off) => { const b = $('selActions').querySelector(`[data-act="${act}"]`); if (b) b.disabled = off; };
  setDisabled('hUp', !isRamp);                      // balandlik faqat rampalar uchun
  setDisabled('hDown', !isRamp);
  setDisabled('smaller', !entry || isRamp);         // rampa kattalashtirilmaydi (nishab buzilmasin)
  setDisabled('bigger', !entry || isRamp);
  const tintBtn = $('selActions').querySelector('[data-act="tint"]');
  if (tintBtn) tintBtn.textContent = isBoard ? 'Reklama №' : 'Rangi';   // reklama ekranida "rang" o'rniga reklama raqami almashadi
}

// ---------- Qo'yish ----------
function placeAt(x, z) {
  if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
  const def = CATALOG[currentType];
  const isTree = def.kind === 'tree';
  const isNature = isTree || def.kind === 'mountain';
  pushUndo();
  if (currentType === 'spawn') {
    const old = entries.find((e) => e.data.t === 'spawn');
    if (old) removeEntry(old);
  }
  addEntry(normalizeObject({
    t: currentType,
    x: clampX(snapV(x)),
    z: clampZ(snapV(z)),
    r: isNature ? Math.random() * Math.PI * 2 : (placeQuarter * Math.PI) / 2,
    s: isTree ? 0.85 + Math.random() * 0.5 : (def.kind === 'mountain' ? 0.85 + Math.random() * 0.4 : 1),
    c: currentType === 'billboard' ? 0 : randomTint(currentType),
    y: placeLevel,
  }));
  scheduleSave();
}

// Palitra
const SWATCH = { house: '#e9dcc3', tree: '#3b8a58', road: '#3a3f47', billboard: '#4b7bec', ramp: '#59606b', mountain: '#7b8570', ridge: '#658f4b', land: '#d9c48f', spawn: '#ffc933' };
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

$('placeLevel').addEventListener('click', () => {
  placeLevel = placeLevel >= RAMP_MAX ? 0 : placeLevel + RAMP_STEP;
  $('placeLevel').textContent = `Balandlik: ${placeLevel} m`;
});
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

function homeView() {
  const size = Math.max(bounds.w + bounds.e, bounds.n + bounds.s);
  const cx = (bounds.e - bounds.w) / 2, cz = (bounds.s - bounds.n) / 2;
  camera.position.set(cx, size * 0.5, cz + size * 0.4);
  controls.target.set(cx, 0, cz);
}
$('resetView').addEventListener('click', homeView);

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
  else if (act === 'hUp' || act === 'hDown') {
    const min = CATALOG[entry.data.t].rise === 0 ? RAMP_STEP : 0;
    const next = (entry.data.y || 0) + (act === 'hUp' ? RAMP_STEP : -RAMP_STEP);
    if (next < min || next > RAMP_MAX) { toast(next < min ? `Bu yo‘l ${min} m dan past bo‘lmaydi` : `Balandlik ${RAMP_MAX} m dan oshmaydi`); return; }
    actOnSelected((e) => { e.data.y = next; });
  }
  else if (act === 'smaller') actOnSelected((e) => { e.data.s = Math.max(0.4, e.data.s / 1.1); });
  else if (act === 'bigger') actOnSelected((e) => { e.data.s = Math.min(3, e.data.s * 1.1); });
  else if (act === 'tint') actOnSelected((e) => { e.data.c = (e.data.c + 1) % TINTS[kind].length; });
  else if (act === 'dup') {
    if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
    if (entry.data.t === 'spawn') { toast('Boshlanish nuqtasi faqat bitta bo‘ladi'); return; }
    pushUndo();
    const copy = addEntry({ ...entry.data, x: clampX(entry.data.x + 6), z: clampZ(entry.data.z + 6) });
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
  entry.data.x = clampX(snapV(x));
  entry.data.z = clampZ(snapV(z));
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

// ---------- Zona kengaytirish ----------
function updateBoundsUI() {
  $('boundsInfo').textContent = `${bounds.w + bounds.e} × ${bounds.n + bounds.s} m`;
  document.querySelectorAll('[data-bound-out]').forEach((o) => { o.textContent = `${bounds[o.dataset.boundOut]} m`; });
}
function setBounds(next) {
  bounds = normalizeBounds(next);
  buildBoundsVisuals();
  updateBoundsUI();
}
document.querySelectorAll('[data-bound]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.bound;
    const delta = Number(btn.dataset.d);
    const value = bounds[key] + delta * BOUNDS_STEP;
    if (value < MIN_EXTENT || value > MAX_EXTENT) {
      toast(value < MIN_EXTENT ? `Bu tomon ${MIN_EXTENT} m dan kichik bo‘lmaydi` : `Bu tomon ${MAX_EXTENT} m dan katta bo‘lmaydi`);
      return;
    }
    pushUndo();
    setBounds({ ...bounds, [key]: value });
    scheduleSave();
    if (delta < 0) {
      const outside = entries.filter((e) => e.data.x < -bounds.w || e.data.x > bounds.e || e.data.z < -bounds.n || e.data.z > bounds.s).length;
      if (outside) toast(`${outside} ta obyekt chegaradan tashqarida qoldi`, 3500);
    }
  });
});

// ---------- Tasodifiy daraxtlar ----------
function plantTrees(count) {
  const feet = entries.map((e) => makeFootprint(e.data)).filter(Boolean);
  const spawnEntry = entries.find((e) => e.data.t === 'spawn');
  pushUndo();
  let planted = 0, tries = 0;
  while (planted < count && tries < count * 25 && entries.length < MAX_OBJECTS) {
    tries++;
    const x = -bounds.w + 4 + Math.random() * (bounds.w + bounds.e - 8);
    const z = -bounds.n + 4 + Math.random() * (bounds.n + bounds.s - 8);
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
  sheet.hidden = true;
  showSaveDialog({ name: 'dexo-gta-zona.json', text: JSON.stringify(currentZone(), null, 2), type: 'application/json' });
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
    setBounds(zone.bounds);
    replaceAll(zone.objects);
    scheduleSave();
    sheet.hidden = true;
    toast('Zona import qilindi');
  } catch {
    toast('Fayl noto‘g‘ri: DEXO GTA zona fayli emas');
  }
});

$('play').addEventListener('click', () => saveNow(false));

// ---------- Umumiy zonani saqlash: zone.json telefonga yuklanadi, keyin GitHub'ga qo'lda yuklanadi ----------
$('save').addEventListener('click', () => {
  saveNow(false);
  showSaveDialog({
    name: 'zone.json',
    text: JSON.stringify(currentZone()),
    type: 'application/json',
    steps: [
    'GitHub’da omboringizni oching va zone.json faylini tanlang (yo‘q bo‘lsa: Add file → Create new file, nomi zone.json).',
    'Qalam belgisini (Edit) bosing, ichidagi hamma matnni o‘chiring va nusxalangan matnni yopishtiring.',
    'Commit changes ni bosing. 1-2 daqiqadan keyin hamma yangi zonani ko‘radi.',
  ],
  });
});

$('pull').addEventListener('click', async () => {
  const zone = await fetchSharedZone();
  if (!zone) { toast('Serverda zone.json topilmadi'); return; }
  if (!confirm('Hozirgi zona serverdagi zona bilan almashtiriladi. Davom etasizmi?')) return;
  pushUndo();
  setBounds(zone.bounds);
  replaceAll(zone.objects);
  scheduleSave();
  sheet.hidden = true;
  toast('Serverdagi zona yuklandi');
});

// ---------- Ishga tushirish ----------
const startZone = loadZone() || (await fetchSharedZone()) || defaultZone();
setBounds(startZone.bounds);
homeView();
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
