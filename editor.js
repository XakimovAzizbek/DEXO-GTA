import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CATALOG, GROUPS, TINTS, ZONE_SIZE, HALF, MAX_OBJECTS, MIN_EXTENT, MAX_EXTENT, BOUNDS_STEP, normalizeBounds, RAMP_STEP, RAMP_MAX,
  loadSettings, loadZone, saveZone, defaultZone, normalizeObject, isValidZone, fetchSharedZone,
  makeFootprint, collideCircle, randomTint,
  TRAFFIC_LIGHT_COLORS, TRAFFIC_HEAD, TRAFFIC_SEC_MIN, TRAFFIC_SEC_MAX,
  isBendable, fetchAirportList, AIRPORT_DEFAULTS, GLB_HOUSE,
} from './data.js';
import { getGeometry, getMaterial, loadCity, buildTrafficLightGroup, refreshTrafficLightGroup, updateTrafficLightGroup, loadAirportModel } from './models.js';
import { showSaveDialog } from './savefile.js';
import { cachedFetchArrayBuffer, evictGLBCache } from './glbCache.js';
import {
  AIR_TYPES, AIR_MAX_POINTS, AIR_MAX_PATHS, AIR_MAX_BOTS,
  normalizeAirPath, buildAirObstacles, checkAirPath, sampleAirPath, groundAt, padBlocked,
} from './airFleet.js';

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
let placeBend = 0;           // qo'yiladigan yo'l/rampaning qayrilmasi: -1 chap, 0 to'g'ri, 1 o'ng
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
  return { v: 1, size: ZONE_SIZE, bounds: { ...bounds }, objects: entries.map((e) => ({ ...e.data })), air: airData() };
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

// ---------- GLB uylar (home-glb.txt) va GLB modellar (modellar.txt) ----------
// home-glb.txt formati:  name: uy   va   glb: home-v2.glb   (bir nechta uy bo'lsa ketma-ket yoziladi).
// GLB uy zonaga { t: 'house_glb', m: <glb fayl>, s: kattalik, y: balandlik (m), w/d: yarim eni/bo'yi } bo'lib saqlanadi.
let houseList = [];            // [{ name, file }]
let currentHouse = null;       // palitradan tanlangan GLB uy/model fayli
let currentSolid = true;       // tanlangan model to'qnashuvli (qattiq) mi
let modelList = [];            // modellar.txt: [{ name, file, solid }]
let glbDragMode = 'move';      // 'move' | 'size' | 'height': barmoq bilan nimani surish
const houseModels = new Map(); // fayl -> Promise<{ root, w, d }>
let houseLoaderPromise = null;

function parseHouseList(text) {
  const clean = String(text).split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  const parts = clean.split(/\b(name|glb|solid)\s*:\s*/i);
  const list = [];
  let cur = null;
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i].toLowerCase();
    const val = (parts[i + 1] || '').trim();
    if (!val) continue;
    if (key === 'name') { cur = { name: val, file: '', solid: true }; list.push(cur); }
    else if (key === 'solid') { if (cur) cur.solid = !/^(no|yo.?q|false|0|off)$/i.test(val); }   // solid: yo'q  -> mashina o'tib ketadi
    else {
      if (!cur || cur.file) { cur = { name: val.replace(/\.glb$/i, ''), file: '', solid: true }; list.push(cur); }
      cur.file = val;
    }
  }
  return list.filter((h) => h.file);
}
function getHouseLoader() {
  if (!houseLoaderPromise) {
    houseLoaderPromise = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]).then(([{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }]) => {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      return loader;
    });
    houseLoaderPromise.catch(() => { houseLoaderPromise = null; });
  }
  return houseLoaderPromise;
}
// Modelni o'lchaydi: eng uzun gorizontal tomoni GLB_HOUSE.size metr, markazi (0,0) da, pastki qismi y = 0 da.
function fitHouse(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = GLB_HOUSE.size / Math.max(size.x, size.z, 0.001);
  const inner = new THREE.Group();
  inner.add(model);
  inner.scale.setScalar(k);
  inner.position.set(-k * (box.min.x + box.max.x) / 2, -k * box.min.y, -k * (box.min.z + box.max.z) / 2);
  const root = new THREE.Group();
  root.add(inner);
  return { root, w: Math.round(size.x * k * 50) / 100, d: Math.round(size.z * k * 50) / 100 };
}
function loadHouseModel(file) {
  if (!houseModels.has(file)) {
    const job = (async () => {
      const loader = await getHouseLoader();
      const names = file.includes('/') ? [file] : [file, `assets/${file}`, `home/${file}`, `houses/${file}`, `models/${file}`, `cars/${file}`, `airport/${file}`];
      let lastErr = null;
      for (const path of names) {
        try {
          const buf = await cachedFetchArrayBuffer(path);
          const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
          const gltf = await new Promise((resolve, reject) => loader.parse(buf, base, resolve, reject));
          let meshes = 0;
          gltf.scene.traverse((o) => { if (o.isMesh) meshes++; });
          if (!meshes) throw new Error('GLB ichida model topilmadi');
          return fitHouse(gltf.scene);
        } catch (err) { lastErr = err; await evictGLBCache(path); }
      }
      throw lastErr || new Error('Fayl topilmadi');
    })();
    houseModels.set(file, job);
    job.catch(() => houseModels.delete(file));   // keyingi urinishda qayta yuklansin
  }
  return houseModels.get(file);
}
// Model yuklanguncha (yoki yuklanmasa) ko'rinadigan oddiy quti: shuni ham tanlash, surish va o'chirish mumkin.
function buildHouseHolder(data) {
  const g = new THREE.Group();
  const hw = (data.w || 5), hd = (data.d || 5);
  const geo = new THREE.BoxGeometry(hw * 2, 6, hd * 2);
  geo.translate(0, 3, 0);
  const ph = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#c9b48a', transparent: true, opacity: 0.55 }));
  g.add(ph);
  g.userData.placeholder = ph;
  return g;
}
function attachHouse(entry) {
  const file = entry.data.m;
  if (!file) return;
  loadHouseModel(file).then((res) => {
    if (!entries.includes(entry)) return;
    const g = entry.mesh;
    const ph = g.userData.placeholder;
    if (ph) { g.remove(ph); ph.geometry.dispose(); ph.material.dispose(); g.userData.placeholder = null; }
    const clone = res.root.clone(true);
    clone.traverse((o) => { o.userData.id = entry.id; });
    g.add(clone);
    if (entry.data.w !== res.w || entry.data.d !== res.d) { entry.data.w = res.w; entry.data.d = res.d; scheduleSave(); }
    if (helper && selectedId === entry.id) helper.update();
    updateSelInfo();
  }).catch((err) => {
    console.warn('GLB uy yuklanmadi:', file, err);
    const ph = entry.mesh.userData.placeholder;
    if (ph) ph.material.color.set('#d9534f');
    toast(`Model topilmadi: ${file}`, 3500);
  });
}

// ---------- Obyektlar ----------
function applyTransform(mesh, data) {
  mesh.position.set(data.x, CATALOG[data.t].glb ? (data.y || 0) : 0, data.z);   // GLB uyning balandligi (y)
  mesh.rotation.set(0, data.r, 0);
  mesh.scale.setScalar(data.s);
}

function addEntry(data) {
  const def = CATALOG[data.t];
  const isTL = def.kind === 'traffic_light';
  const isGLB = !!def.glb;
  const mesh = isTL ? buildTrafficLightGroup(data) : isGLB ? buildHouseHolder(data) : new THREE.Mesh(getGeometry(data.t, data.y || 0, data.bend || 0), getMaterial(def.kind, data.c));
  applyTransform(mesh, data);
  const entry = { id: nextId++, data, mesh };
  mesh.userData.id = entry.id;
  if (isTL || isGLB) mesh.traverse((o) => { o.userData.id = entry.id; });   // guruh ichidagi har bir bo'lak ham tanlansin
  scene.add(mesh);
  entries.push(entry);
  if (isGLB) attachHouse(entry);
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
  if (CATALOG[entry.data.t].kind === 'traffic_light') {
    refreshTrafficLightGroup(entry.mesh, entry.data);
  } else if (CATALOG[entry.data.t].glb) {
    // GLB uy: faqat joyi/burilishi/kattaligi/balandligi (applyTransform) o'zgaradi
  } else {
    entry.mesh.geometry = getGeometry(entry.data.t, entry.data.y || 0, entry.data.bend || 0);   // rampa balandligi/burilishi o'zgarganda
    entry.mesh.material = getMaterial(CATALOG[entry.data.t].kind, entry.data.c);
  }
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
  const isRoute = !!entry && CATALOG[entry.data.t].kind === 'route';
  const isRamp = !!entry && CATALOG[entry.data.t].kind === 'ramp';
  const isTL = !!entry && CATALOG[entry.data.t].kind === 'traffic_light';
  const isGlb = !!entry && !!CATALOG[entry.data.t].glb;
  const isBend = !!entry && isBendable(entry.data.t);
  const bendLabel = (b) => (b < 0 ? 'chapga' : b > 0 ? 'o‘ngga' : 'to‘g‘ri');
  $('selInfo').textContent = entry
    ? `${isGlb && entry.data.m ? entry.data.m : CATALOG[entry.data.t].label}: x ${Math.round(entry.data.x)}, z ${Math.round(entry.data.z)}, kattalik ×${entry.data.s.toFixed(2)}${isBoard ? `, reklama №${entry.data.c + 1}` : ''}${isRoute ? `, marshrut №${entry.data.c + 1}` : ''}${isRamp ? `, balandlik ${entry.data.y || 0} m` : ''}${isGlb ? `, balandlik ${(entry.data.y || 0).toFixed(1)} m` : ''}${isBend ? `, burilish: ${bendLabel(entry.data.bend || 0)}` : ''}${isTL ? ', svetofor: pastdagi ro‘yxatdan chiroqni tanlab suring' : ''}`
    : 'Obyektni tanlash uchun unga bosing. Tanlangach barmoq bilan surib qo‘ying.';
  $('selActions').querySelectorAll('button').forEach((b) => { b.disabled = !entry; });
  const setDisabled = (act, off) => { const b = $('selActions').querySelector(`[data-act="${act}"]`); if (b) b.disabled = off; };
  setDisabled('hUp', !isRamp && !isGlb);            // balandlik faqat rampalar va GLB uylar uchun
  setDisabled('hDown', !isRamp && !isGlb);
  setDisabled('tint', isGlb);                       // GLB uyning o'z ranglari bor
  setDisabled('smaller', !entry || isRamp);         // rampa kattalashtirilmaydi (nishab buzilmasin)
  setDisabled('bigger', !entry || isRamp);
  setDisabled('bend', !isBend);                     // qayrilma faqat to'g'ri yo'l/rampa uchun
  const tintBtn = $('selActions').querySelector('[data-act="tint"]');
  if (tintBtn) tintBtn.textContent = isBoard ? 'Reklama №' : isRoute ? 'Marshrut №' : 'Rangi';   // reklama/marshrutda "rang" o'rniga tartib raqami almashadi
  updateLightPanel(entry, isTL);
  updateGlbPanel(entry, isGlb);
}

// ---------- Svetofor: chiroqlarni tanlash/surish/soniya paneli ----------
let lightDragColor = null;   // hozir qaysi chiroq (red/yellow/green) sudrab joylashtirilyapti
function updateLightPanel(entry, isTL) {
  const panel = $('lightPanel');
  if (!panel) return;
  panel.hidden = !isTL;
  if (!isTL) { lightDragColor = null; $('lightDragHint').hidden = true; return; }
  entry.data.lights.forEach((l, i) => {
    const row = panel.querySelector(`[data-light="${i}"]`);
    row.querySelector('.light-sec').value = l.sec;
    row.querySelector('.light-pick').classList.toggle('is-active', lightDragColor === l.color);
  });
  $('lightStart').value = String(entry.data.start || 0);
  $('lightDragHint').hidden = !lightDragColor;
}
$('lightPanel').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.light-pick');
  if (!btn) return;
  lightDragColor = lightDragColor === btn.dataset.color ? null : btn.dataset.color;
  updateSelInfo();
});
$('lightPanel').addEventListener('change', (ev) => {
  const input = ev.target.closest('.light-sec');
  const entry = getEntry(selectedId);
  if (!input || !entry || CATALOG[entry.data.t].kind !== 'traffic_light') return;
  const i = Number(input.closest('.light-row').dataset.light);
  pushUndo();
  entry.data.lights[i].sec = Math.max(TRAFFIC_SEC_MIN, Math.min(TRAFFIC_SEC_MAX, Math.round(Number(input.value) || TRAFFIC_SEC_MIN)));
  scheduleSave();
});
$('lightStart').addEventListener('change', () => {
  const entry = getEntry(selectedId);
  if (!entry || CATALOG[entry.data.t].kind !== 'traffic_light') return;
  pushUndo();
  entry.data.start = Math.abs(Math.floor(Number($('lightStart').value) || 0)) % 3;
  scheduleSave();
});

// ---------- Qo'yish ----------
function placeAt(x, z) {
  if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
  const def = CATALOG[currentType];
  const isTree = def.kind === 'tree';
  const isNature = isTree || def.kind === 'mountain';
  if (def.glb && !currentHouse) { toast('Avval ro‘yxatdan GLB model yoki uyni tanlang'); return; }
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
    bend: isBendable(currentType) ? placeBend : 0,
    ...(def.glb ? { m: currentHouse, ...(currentType === 'model_glb' && !currentSolid ? { k: 0 } : {}) } : {}),
  }));
  scheduleSave();
}

// Palitra
const SWATCH = { house: '#e9dcc3', tree: '#3b8a58', road: '#3a3f47', billboard: '#4b7bec', ramp: '#59606b', mountain: '#7b8570', ridge: '#658f4b', land: '#d9c48f', route: '#ff5252', spawn: '#ffc933', traffic_light: '#22262e' };
const palette = $('palette');
let glbSlot = null, modelSlot = null;
for (const group of GROUPS) {
  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = group;
  palette.append(label);
  for (const [type, def] of Object.entries(CATALOG)) {
    if (def.group !== group) continue;
    if (def.glb) continue;   // GLB uylar home-glb.txt dan alohida chip bo'lib qo'shiladi
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.type = type;
    const swatch = document.createElement('i');
    swatch.style.background = SWATCH[def.kind];
    const text = document.createElement('span');
    text.textContent = def.label;
    btn.append(swatch, text);
    btn.addEventListener('click', () => { currentType = type; markActiveChip(); updatePlaceBendUI(); });
    palette.append(btn);
  }
  if (group === 'Uylar') { glbSlot = document.createElement('span'); glbSlot.style.display = 'contents'; palette.append(glbSlot); }
  if (group === 'Modellar') { modelSlot = document.createElement('span'); modelSlot.style.display = 'contents'; palette.append(modelSlot); }
}
function markActiveChip() {
  palette.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.glb ? (currentType === c.dataset.type && c.dataset.glb === currentHouse) : c.dataset.type === currentType));
}
// home-glb.txt dagi uylarni va modellar.txt dagi modellarni palitraga qo'shish
function addGlbChips(slot, list, type, suffix) {
  if (!slot) return;
  slot.textContent = '';
  for (const h of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.type = type;
    btn.dataset.glb = h.file;
    const swatch = document.createElement('i');
    swatch.style.background = '#e9dcc3';
    swatch.style.borderColor = '#ffc933';
    const text = document.createElement('span');
    text.textContent = `${h.name}${suffix}`;
    btn.append(swatch, text);
    btn.addEventListener('click', () => {
      currentType = type; currentHouse = h.file; currentSolid = h.solid !== false;
      markActiveChip(); updatePlaceBendUI();
      loadHouseModel(h.file).catch(() => toast(`Model topilmadi: ${h.file}`, 3500));   // oldindan yuklab qo'yamiz
    });
    slot.append(btn);
  }
  markActiveChip();
}
const addHouseChips = () => addGlbChips(glbSlot, houseList, 'house_glb', ' (GLB)');
const addModelChips = () => addGlbChips(modelSlot, modelList, 'model_glb', '');
fetch('home-glb.txt', { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => { houseList = parseHouseList(t); })
  .catch(() => { houseList = []; })
  .then(() => addHouseChips());
fetch('modellar.txt', { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => { modelList = parseHouseList(t); })
  .catch(() => { modelList = []; })
  .then(() => {
    addModelChips();
    if (!modelList.length && modelSlot) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'modellar.txt topilmadi yoki bo‘sh';
      modelSlot.append(hint);
    }
  });
markActiveChip();

$('placeLevel').addEventListener('click', () => {
  placeLevel = placeLevel >= RAMP_MAX ? 0 : placeLevel + RAMP_STEP;
  $('placeLevel').textContent = `Balandlik: ${placeLevel} m`;
});
$('placeRot').addEventListener('click', () => {
  placeQuarter = (placeQuarter + 1) % 4;
  $('placeRot').textContent = `Burish: ${placeQuarter * 90}°`;
});
// Qayrilma: to'g'ri yo'l/rampani bir necha gradusga qiyshaytiradi (90° burish emas — yoy shaklida qayriladi),
// shu bois ketma-ket qo'yilgan bo'laklar burchakda sinib qolmay silliq qayrilma hosil qiladi.
const BEND_LABEL = { 0: 'to‘g‘ri', 1: 'o‘ngga', [-1]: 'chapga' };
function updatePlaceBendUI() {
  const on = isBendable(currentType);
  $('placeBend').hidden = !on;
  if (!on) placeBend = 0;
  $('placeBend').textContent = `Burilish: ${BEND_LABEL[placeBend]}`;
}
$('placeBend').addEventListener('click', () => {
  placeBend = ((placeBend + 2) % 3) - 1;   // to'g'ri → o'ng → chap → to'g'ri
  updatePlaceBendUI();
});
updatePlaceBendUI();

// ---------- Havo yo'llari (AI samolyot va vertolyotlar uchun) ----------
// Qo'lda: xaritaga ketma-ket bosasiz, har bosish - yo'l nuqtasi (balandligi bilan). 3+ nuqtadan keyin yo'l o'zi yopiladi.
// AI: "AI yo'llar" tugmasi 10 ta xavfsiz yo'l qo'shadi; "Joy belgilash" + "AI: shu joydan" esa belgilangan joydan uchib,
// aylanib kelib shu joyga qo'nadigan yo'l qo'shadi ("Uzoqroq" / "Yaqinroq" bilan masofa o'zgaradi).
// Xavfli joylar (tog', uy, bino ustidan past o'tish) qizil nuqta bilan ko'rinadi; "Avto-tuzatish" ularni ko'taradi.
let airPaths = [];            // [{ type, model?, count, pad?, pts: [[x, z, balandlik], ...] }]
let airActive = -1;
let airType = 'plane';
let airModel = null;          // airport.txt dagi tanlangan model nomi (null = kodda yasalgan oddiy model)
let airAlt = AIR_TYPES.plane.defAlt;
let airCount = 1;
let airStatus = [];
let airModels = [];           // airport.txt dan: [{ name, kind: 'plane' | 'heli', entry }]
let airPad = null;            // uchish/qo'nish joyi [x, z]
let airPadMode = false;       // true bo'lsa, keyingi bosish joyni belgilaydi
let airRange = 1;             // AI masofa darajasi (1 = eng yaqin)
let airBusy = false;          // AI hisoblayotganda ikkinchi marta bosilmasin
const AIR_RANGE_MAX = 10;
const AIR_AI_BATCH = 10;
const AIR_ICON = { plane: '✈️', heli: '🚁' };
const PAD_KEY = 'dexo-gta:airpad';
const airGroup = new THREE.Group();
scene.add(airGroup);
const airDotGeo = new THREE.SphereGeometry(1, 10, 8);
const airPreview = new Map();       // model nomi -> Object3D | 'loading' | 'fail'  (editorda ko'rsatish uchun)
const airStatusCache = new Map();   // yo'l imzosi -> { sig, res }  (har safar qayta hisoblamaslik uchun)

try {
  const q = JSON.parse(localStorage.getItem(PAD_KEY));
  if (Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)) airPad = q;
} catch { /* xotira yopiq - belgilangan joy saqlanmaydi */ }
function saveAirPad() {
  try { if (airPad) localStorage.setItem(PAD_KEY, JSON.stringify(airPad)); else localStorage.removeItem(PAD_KEY); } catch { /* jim */ }
}

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const r1 = (v) => Math.round(v * 10) / 10;
const tick = () => new Promise((r) => setTimeout(r, 0));
const airObs = () => buildAirObstacles(entries.map((e) => e.data));

function airData() {
  return airPaths.map((p) => {
    const o = { type: p.type, count: p.count, pts: p.pts.map((q) => q.slice()) };
    if (p.model) o.model = p.model;
    if (p.pad) o.pad = p.pad.slice();
    if (p.speed) o.speed = p.speed;
    return o;
  });
}
function loadAir(list) {
  airPaths = (Array.isArray(list) ? list : []).slice(0, AIR_MAX_PATHS).map(normalizeAirPath).filter((p) => p.pts.length > 0);
  airActive = -1;
  drawAir();
}
function clearAirGroup() {
  for (const c of airGroup.children.slice()) {
    airGroup.remove(c);
    if (c.geometry && c.geometry !== airDotGeo) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}

// ----- airport.txt dagi samolyot/vertolyotlar (GLB) -----
function airOptions() {
  return airModels.length
    ? airModels
    : [{ name: null, kind: 'plane', entry: null }, { name: null, kind: 'heli', entry: null }];
}
const airOptLabel = (o) => o.name || (o.kind === 'heli' ? 'Vertolyot' : 'Samolyot');
function currentAirOption() {
  const all = airOptions();
  return all.find((o) => o.name === airModel && o.kind === airType) || all.find((o) => o.kind === airType) || all[0];
}
function ensureAirPreview(name) {
  if (!name || airPreview.has(name)) return;
  const opt = airModels.find((m) => m.name === name);
  if (!opt) return;
  airPreview.set(name, 'loading');
  loadAirportModel({ ...AIRPORT_DEFAULTS, ...opt.entry })
    .then((root) => { airPreview.set(name, root); drawAir(); })
    .catch((err) => { airPreview.set(name, 'fail'); console.warn('Havo modeli yuklanmadi:', name, err); });
}
fetchAirportList().then((list) => {
  airModels = list.map((a) => ({ name: a.name, kind: a.kind === 'helicopter' ? 'heli' : 'plane', entry: a }));
  if (!airModel) {
    const first = airModels.find((m) => m.kind === airType) || airModels[0];
    if (first) { airModel = first.name; airType = first.kind; airAlt = AIR_TYPES[airType].defAlt; }
  }
  if (airModel) ensureAirPreview(airModel);
  drawAir();
}).catch(() => { /* airport.txt yo'q: oddiy samolyot/vertolyot tanlanadi */ });

function selectAirOption(o) {
  const changed = airType !== o.kind;
  airModel = o.name;
  airType = o.kind;
  if (changed) airAlt = AIR_TYPES[airType].defAlt;
  const p = airPaths[airActive];
  if (p) {
    p.type = airType;
    if (airModel) p.model = airModel; else delete p.model;
    for (const q of p.pts) q[2] = Math.min(q[2], AIR_TYPES[airType].maxAlt);
    scheduleSave();
  }
  if (airModel) ensureAirPreview(airModel);
  drawAir();
}

// ----- Chizish -----
function pathSignature(p) {
  return `${p.type}|${p.pad ? p.pad.join(',') : ''}|${p.pts.map((q) => q.join(',')).join(';')}`;
}
function drawAir() {
  clearAirGroup();
  airStatus = [];
  const obs = airObs();
  const obsSig = entries.map((e) => `${e.data.t}${e.data.x}${e.data.z}${e.data.r}${e.data.s}${e.data.y || 0}${e.data.bend || 0}`).join('|');
  const alive = new Set();
  const badPts = [];
  airPaths.forEach((p, idx) => {
    const T = AIR_TYPES[p.type];
    const active = idx === airActive;
    let res = null;
    if (p.pts.length >= 3) {
      const key = pathSignature(p);
      alive.add(key);
      const hit = airStatusCache.get(key);
      if (hit && hit.sig === obsSig) res = hit.res;
      else { res = checkAirPath(p, obs, false); airStatusCache.set(key, { sig: obsSig, res }); }
    }
    airStatus[idx] = res;
    if (res) for (const b of res.bad.slice(0, 60)) badPts.push(b.x, b.y, b.z);

    const samples = sampleAirPath(p);
    if (p.pts.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(samples),
        new THREE.LineBasicMaterial({ color: T.color, transparent: true, opacity: active ? 1 : 0.5 }),
      );
      airGroup.add(line);
    }
    const drops = [];
    p.pts.forEach((q, k) => {
      drops.push(new THREE.Vector3(q[0], 0.1, q[1]), new THREE.Vector3(q[0], q[2], q[1]));
      const dot = new THREE.Mesh(airDotGeo, new THREE.MeshBasicMaterial({ color: k === 0 ? 0xffffff : T.color }));
      dot.position.set(q[0], q[2], q[1]);
      dot.scale.setScalar(active ? (k === 0 ? 3 : 2.2) : 1.4);
      airGroup.add(dot);
    });
    airGroup.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(drops),
      new THREE.LineBasicMaterial({ color: T.color, transparent: true, opacity: active ? 0.45 : 0.2 }),
    ));

    // GLB modelning o'zi yo'lning boshida (uchish joyida) ko'rinadi
    if (p.model && p.pts.length) {
      const src = airPreview.get(p.model);
      if (src && typeof src !== 'string') {
        const m = src.clone(true);
        const q0 = p.pts[0];
        m.position.set(q0[0], q0[2], q0[1]);
        if (samples.length > 1) m.rotation.y = Math.atan2(samples[1].x - samples[0].x, samples[1].z - samples[0].z);
        airGroup.add(m);
      } else ensureAirPreview(p.model);
    }
  });
  for (const key of airStatusCache.keys()) if (!alive.has(key)) airStatusCache.delete(key);

  if (badPts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(badPts, 3));
    airGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff2d2d, size: 8, sizeAttenuation: false })));
  }

  if (airPad) {   // uchish/qo'nish joyi belgisi
    const gy = groundAt(obs, airPad[0], airPad[1]);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6, 8.5, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: airPadMode ? 0xffc933 : 0x2ee86f, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.position.set(airPad[0], gy + 0.2, airPad[1]);
    ring.renderOrder = 6;
    airGroup.add(ring);
    airGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(airPad[0], gy, airPad[1]), new THREE.Vector3(airPad[0], gy + 30, airPad[1])]),
      new THREE.LineBasicMaterial({ color: 0x2ee86f }),
    ));
  }
  updateAirUI();
}

function padDistance(kind, level) {
  const T = AIR_TYPES[kind];
  return T.range0 + (level - 1) * T.rangeStep;
}

function updateAirUI() {
  if (!$('airInfo')) return;
  const p = airPaths[airActive];
  $('airAltLabel').textContent = `${airAlt} m`;
  $('airCount').textContent = `Botlar: ${airCount}`;
  $('airRangeLabel').textContent = `Masofa: ${padDistance(airType, airRange)} m`;
  $('airPadSet').classList.toggle('is-active', airPadMode);
  $('airPadSet').textContent = airPadMode ? '📍 Xaritaga bosing…' : (airPad ? '📍 Joyni o‘zgartirish' : '📍 Joy belgilash');
  $('airPadClear').disabled = !airPad;
  for (const id of ['airAuto', 'airPadAI', 'airFar', 'airNear']) $(id).disabled = airBusy;

  // Model tanlash tugmalari (airport.txt dagi GLB fayllar)
  const box = $('airModels');
  box.textContent = '';
  for (const o of airOptions()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini mini--model' + (o.name === airModel && o.kind === airType ? ' is-active' : '');
    b.textContent = `${AIR_ICON[o.kind]} ${airOptLabel(o)}`;
    b.addEventListener('click', () => selectAirOption(o));
    box.append(b);
  }

  let text;
  if (airPadMode) {
    text = '📍 Xaritada samolyot/vertolyot uchib chiqadigan va qaytib qo‘nadigan joyni bosing.';
  } else if (!p) {
    text = airPaths.length
      ? `Jami ${airPaths.length} ta yo‘l. Pastdagi ro‘yxatdan yo‘lni tanlang yoki xaritaga bosib yangi yo‘l boshlang.`
      : 'Xaritaga ketma-ket bosing: har bosish bitta yo‘l nuqtasi (oq nuqta - boshi). Kamida 3 nuqta kerak. Yoki “🤖 AI yo‘llar” ni bosing.';
  } else {
    const st = airStatus[airActive];
    const head = `${AIR_ICON[p.type]} ${p.model ? `${p.model}, ` : ''}${p.pts.length} nuqta, ${p.count} bot${p.pad ? ', 🛫 uchish/qo‘nish bor' : ''}. `;
    if (!st) text = head + `Yo‘l yopilishi uchun yana ${3 - p.pts.length} nuqta kerak.`;
    else if (st.ok) text = head + '✅ Yo‘l xavfsiz.';
    else text = head + `⚠️ ${st.bad.length} joyda to‘siqqa yaqin (qizil nuqta). “Avto-tuzatish” ni bosing.`;
  }
  if (airPad && !airPadMode) text += ` 📍 Joy: x ${Math.round(airPad[0])}, z ${Math.round(airPad[1])}.`;
  $('airInfo').textContent = text;

  const list = $('airList');
  list.textContent = '';
  airPaths.forEach((q, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini' + (i === airActive ? ' is-active' : '');
    b.textContent = `${AIR_ICON[q.type]} ${i + 1}${q.pad ? ' 🛫' : ''}`;
    b.addEventListener('click', () => {
      airActive = i; airType = q.type; airCount = q.count; airModel = q.model || null;
      airAlt = q.pts.length ? Math.round(q.pts[q.pts.length - 1][2]) : AIR_TYPES[q.type].defAlt;
      drawAir();
    });
    list.append(b);
  });
}
function airChanged() { scheduleSave(); drawAir(); }

// ----- Qo'lda nuqta qo'shish -----
function setAirPad(x, z) {
  airPad = [clampX(snapV(x)), clampZ(snapV(z))];
  airPadMode = false;
  saveAirPad();
  if (padBlocked(airObs(), airPad[0], airPad[1])) toast('Diqqat: bu joyda to‘siq (uy, daraxt yoki tog‘) bor. Bo‘sh joyni belgilang.', 4500);
  else toast('Uchish/qo‘nish joyi belgilandi. Endi “🛫 AI: shu joydan” ni bosing', 3500);
  drawAir();
}
function addAirPoint(x, z) {
  if (airPadMode) { setAirPad(x, z); return; }
  let p = airPaths[airActive];
  if (!p) {
    p = { type: airType, count: airCount, pts: [] };
    if (airModel) p.model = airModel;
    airPaths.push(p);
    airActive = airPaths.length - 1;
  }
  if (p.pts.length >= AIR_MAX_POINTS) { toast(`Bir yo‘lda eng ko‘pi bilan ${AIR_MAX_POINTS} ta nuqta`); return; }
  const px = clampX(snapV(x)), pz = clampZ(snapV(z));
  const last = p.pts[p.pts.length - 1];
  if (last && Math.hypot(px - last[0], pz - last[1]) < 1.5) { toast('Nuqta oldingisiga juda yaqin'); return; }
  p.pts.push([px, pz, airAlt]);
  airChanged();
}

function stepAirAlt(d) {
  const T = AIR_TYPES[airType];
  airAlt = Math.max(10, Math.min(T.maxAlt, airAlt + d));
  updateAirUI();
}
$('airAltDown').addEventListener('click', () => stepAirAlt(-10));
$('airAltUp').addEventListener('click', () => stepAirAlt(10));
$('airCount').addEventListener('click', () => {
  airCount = airCount % AIR_MAX_BOTS + 1;
  const p = airPaths[airActive];
  if (p) { p.count = airCount; scheduleSave(); }
  updateAirUI();
});
$('airNew').addEventListener('click', () => { airActive = -1; drawAir(); toast('Yangi yo‘l: xaritaga bosing'); });
$('airUndoPt').addEventListener('click', () => {
  const p = airPaths[airActive];
  if (!p) return;
  p.pts.pop();
  if (!p.pts.length) { airPaths.splice(airActive, 1); airActive = -1; }
  else if (p.pad && Math.hypot(p.pts[0][0] - p.pad[0], p.pts[0][1] - p.pad[1]) > 1.5) delete p.pad;
  airChanged();
});
function shiftAirPath(d) {
  const p = airPaths[airActive];
  if (!p) { toast('Avval pastdagi ro‘yxatdan yo‘lni tanlang'); return; }
  const T = AIR_TYPES[p.type];
  p.pts.forEach((q, i) => {
    if (p.pad && i === 0) return;   // uchish/qo'nish nuqtasi yerda qoladi
    q[2] = Math.max(p.pad ? p.pts[0][2] + 1 : 5, Math.min(T.maxAlt, q[2] + d));
  });
  airChanged();
}
$('airShiftDown').addEventListener('click', () => shiftAirPath(-10));
$('airShiftUp').addEventListener('click', () => shiftAirPath(10));

// ----- Avto-tuzatish -----
// Yo'l tanlangan bo'lsa - o'sha yo'l, tanlanmagan bo'lsa - hamma yo'llar tuzatiladi.
$('airFix').addEventListener('click', () => {
  if (!airPaths.length) {
    toast('Hali yo‘l yo‘q. Xaritaga bosib yo‘l chizing yoki “🤖 AI yo‘llar” ni bosing.', 4000);
    return;
  }
  const obs = airObs();
  const p = airPaths[airActive];
  if (p) {
    if (p.pts.length < 3) {
      const need = 3 - p.pts.length;
      toast(`Bu yo‘lda hozir ${p.pts.length} ta nuqta bor. Tuzatish uchun kamida 3 ta kerak: xaritaga yana ${need} ta nuqta bosing.`, 4500);
      return;
    }
    const res = checkAirPath(p, obs, true);
    p.pts = res.pts;
    airChanged();
    if (res.ok) toast(res.raised ? `${res.raised} ta nuqta ko‘tarildi, yo‘l xavfsiz ✅` : 'Yo‘l allaqachon xavfsiz ✅');
    else toast('Maksimal balandlikda ham xavfsiz bo‘lmadi: yo‘lni to‘siqdan (tog‘, bino) chetlab o‘tkazing yoki o‘chiring.', 5000);
    return;
  }
  let checked = 0, raised = 0;
  const failed = [];
  airPaths.forEach((q, i) => {
    if (q.pts.length < 3) return;
    const res = checkAirPath(q, obs, true);
    q.pts = res.pts;
    checked++;
    raised += res.raised;
    if (!res.ok) failed.push(i + 1);
  });
  if (!checked) { toast('Hamma yo‘lda 3 tadan kam nuqta bor. Xaritaga yana nuqta bosing.', 4000); return; }
  airChanged();
  if (failed.length) toast(`${checked} ta yo‘l tekshirildi. № ${failed.join(', ')} yo‘llar maksimal balandlikda ham xavfsiz emas: ularni to‘siqdan chetlating yoki o‘chiring.`, 6000);
  else toast(`${checked} ta yo‘l tekshirildi: ${raised} ta nuqta ko‘tarildi, hammasi xavfsiz ✅`, 3500);
});
$('airDel').addEventListener('click', () => {
  if (!airPaths[airActive]) { toast('Avval pastdagi ro‘yxatdan yo‘lni tanlang'); return; }
  airPaths.splice(airActive, 1);
  airActive = -1;
  airChanged();
});

// ----- AI: yo'l yasash -----
function insideBounds(samples, m) {
  return samples.every((v) => v.x >= -bounds.w + m && v.x <= bounds.e - m && v.z >= -bounds.n + m && v.z <= bounds.s - m);
}
// Yangi yo'l boshqa yo'llar bilan bir xil balandlikda kesishmasligi uchun: kesishgan joylar soni
function crossConflicts(samples, others, T, pad) {
  const sepH = Math.max(T.margin * 2, 24), sepV = 16;
  let n = 0;
  for (const a of samples) {
    if (pad && Math.hypot(a.x - pad[0], a.z - pad[1]) < T.padR) continue;
    let hit = false;
    for (const set of others) {
      for (const b of set) {
        if (Math.abs(a.y - b.y) < sepV && Math.hypot(a.x - b.x, a.z - b.z) < sepH) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) n++;
  }
  return n;
}

// Zona ichida yopiq halqa: tasodifiy shakl va balandlikda; to'siqlar ustidan o'zi ko'tariladi.
function genFreeLoop(opt, obs, others) {
  const T = AIR_TYPES[opt.kind];
  const minX = -bounds.w, maxX = bounds.e, minZ = -bounds.n, maxZ = bounds.s;
  const span = Math.min(maxX - minX, maxZ - minZ);
  const rMax = Math.max(20, span * 0.4);
  const rMin = Math.max(15, rMax * 0.4);
  let best = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const rx = rand(rMin, rMax), rz = rand(rMin, rMax);
    const loX = minX + rx + 8, hiX = maxX - rx - 8, loZ = minZ + rz + 8, hiZ = maxZ - rz - 8;
    const cx = loX < hiX ? rand(loX, hiX) : (minX + maxX) / 2;
    const cz = loZ < hiZ ? rand(loZ, hiZ) : (minZ + maxZ) / 2;
    const K = 6 + Math.floor(Math.random() * 4);
    const rot = rand(0, TAU), dir = Math.random() < 0.5 ? 1 : -1;
    const base = Math.max(T.minAlt, Math.min(T.maxAlt * 0.85, T.defAlt * rand(0.7, 1.5)));
    const pts = [];
    for (let k = 0; k < K; k++) {
      const phi = dir * (TAU * k / K) + rand(-0.2, 0.2);
      const rr = rand(0.8, 1.15);
      const ex = Math.cos(phi) * rx * rr, ez = Math.sin(phi) * rz * rr;
      pts.push([
        r1(cx + ex * Math.cos(rot) - ez * Math.sin(rot)),
        r1(cz + ex * Math.sin(rot) + ez * Math.cos(rot)),
        r1(Math.max(T.minAlt, base + rand(-8, 8))),
      ]);
    }
    const path = normalizeAirPath({ type: opt.kind, model: opt.name || undefined, count: airCount, pts });
    if (path.pts.length < 3) continue;
    const res = checkAirPath(path, obs, true);
    if (!res.ok) continue;
    path.pts = res.pts;
    const samples = sampleAirPath(path, 6);
    if (!insideBounds(samples, 4)) continue;
    const score = (res.gain || 0) + crossConflicts(samples, others, T, null) * 40;
    if (!best || score < best.score) best = { path, score, samples };
    if (score < 1) break;
  }
  return best;
}

// Belgilangan joydan uchib, halqa bo'ylab aylanib, o'sha joyga qo'nadigan yo'l.
// Halqa joydan o'tadi: 1-nuqta - yerda (pad), keyin ko'tarilish, aylanish, pastlash, yana pad.
const PAD_PROFILE = [0, 0.35, 0.8, 1, 1, 1, 1, 1, 0.8, 0.35];
function genPadRoute(opt, level, obs, others, usedHeads) {
  const T = AIR_TYPES[opt.kind];
  const R = padDistance(opt.kind, level) / 2;
  const [px, pz] = airPad;
  const gy = groundAt(obs, px, pz) + 0.5;
  const K = PAD_PROFILE.length;
  let best = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const a = rand(0, TAU);
    const cx = px + Math.cos(a) * R, cz = pz + Math.sin(a) * R;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const phi0 = Math.atan2(pz - cz, px - cx);
    const H = Math.max(T.minAlt, Math.min(T.maxAlt * 0.85, T.defAlt * rand(0.8, 1.4)));
    const wob = rand(0.05, 0.14), wp = rand(0, TAU);
    const pts = [];
    for (let k = 0; k < K; k++) {
      const phi = phi0 + dir * TAU * k / K;
      const rr = k === 0 ? 1 : 1 + wob * Math.sin(wp + k * 1.7);
      pts.push([
        r1(k === 0 ? px : cx + Math.cos(phi) * R * rr),
        r1(k === 0 ? pz : cz + Math.sin(phi) * R * rr),
        r1(gy + PAD_PROFILE[k] * (H - gy)),
      ]);
    }
    const path = normalizeAirPath({ type: opt.kind, model: opt.name || undefined, count: airCount, pad: [px, pz], pts });
    if (!path.pad || path.pts.length < K) continue;
    const res = checkAirPath(path, obs, true);
    if (!res.ok) continue;
    path.pts = res.pts;
    const samples = sampleAirPath(path, 6);
    if (!insideBounds(samples, 4)) continue;
    const head = Math.atan2(path.pts[1][0] - px, path.pts[1][1] - pz);
    const same = usedHeads.some((h) => Math.abs(Math.atan2(Math.sin(h - head), Math.cos(h - head))) < 0.6) ? 60 : 0;   // oldingi yo'llardan farqli yo'nalish
    const score = (res.gain || 0) + crossConflicts(samples, others, T, [px, pz]) * 40 + same;
    if (!best || score < best.score) best = { path, score };
    if (score < 1) break;
  }
  return best;
}

const otherSamples = () => airPaths.filter((p) => p.pts.length >= 3).map((p) => sampleAirPath(p, 6));

async function addAiLoops() {
  if (airBusy) return;
  airBusy = true; updateAirUI();
  toast('AI yo‘llarni hisoblayapti…', 1500);
  await tick();
  try {
    const opt = currentAirOption();
    const obs = airObs();
    const others = otherSamples();
    let added = 0;
    for (let i = 0; i < AIR_AI_BATCH; i++) {
      const best = genFreeLoop(opt, obs, others);
      if (best) { airPaths.push(best.path); others.push(best.samples); added++; }
      await tick();
    }
    if (!added) { toast('Xavfsiz yo‘l topilmadi: zona kichik yoki to‘siqlar juda baland. Zonani kengaytirib ko‘ring.', 5000); return; }
    airActive = airPaths.length - 1;
    airType = airPaths[airActive].type;
    scheduleSave();
    toast(added < AIR_AI_BATCH
      ? `${added} ta yo‘l qo‘shildi (qolganiga xavfsiz joy topilmadi) ✅`
      : `${added} ta xavfsiz yo‘l qo‘shildi ✅`, 3500);
  } finally {
    airBusy = false;
    drawAir();
  }
}

async function addPadRoute(level) {
  if (airBusy) return false;
  if (!airPad) { toast('Avval “📍 Joy belgilash” ni bosib, xaritada uchish/qo‘nish joyini belgilang.', 4500); return false; }
  const obs = airObs();
  if (padBlocked(obs, airPad[0], airPad[1])) { toast('Belgilangan joyda to‘siq (uy, daraxt yoki tog‘) bor. Bo‘sh joyni qayta belgilang.', 4500); return false; }
  airBusy = true; updateAirUI();
  toast('AI yo‘lni hisoblayapti…', 1500);
  await tick();
  try {
    const opt = currentAirOption();
    const used = airPaths
      .filter((p) => p.pad && p.pts.length > 1 && Math.hypot(p.pad[0] - airPad[0], p.pad[1] - airPad[1]) < 2)
      .map((p) => Math.atan2(p.pts[1][0] - p.pad[0], p.pts[1][1] - p.pad[1]));
    const best = genPadRoute(opt, level, obs, otherSamples(), used);
    if (!best) {
      toast(`${padDistance(opt.kind, level)} m masofaga xavfsiz yo‘l topilmadi (zona kichik yoki to‘siq ko‘p). “Yaqinroq” ni bosing yoki zonani kengaytiring.`, 5500);
      return false;
    }
    airPaths.push(best.path);
    airActive = airPaths.length - 1;
    airType = best.path.type;
    scheduleSave();
    toast(`🛫 Yo‘l qo‘shildi: ${padDistance(opt.kind, level)} m gacha uchib, shu joyga qo‘nadi ✅`, 3500);
    return true;
  } finally {
    airBusy = false;
    drawAir();
  }
}

$('airAuto').addEventListener('click', addAiLoops);
$('airPadSet').addEventListener('click', () => {
  airPadMode = !airPadMode;
  if (airPadMode) toast('Xaritada uchish va qo‘nish joyini bosing');
  drawAir();
});
$('airPadClear').addEventListener('click', () => { airPad = null; airPadMode = false; saveAirPad(); drawAir(); });
$('airPadAI').addEventListener('click', () => { addPadRoute(airRange); });
$('airFar').addEventListener('click', async () => {
  if (airRange >= AIR_RANGE_MAX) { toast('Bu eng uzoq masofa'); return; }
  if (await addPadRoute(airRange + 1)) { airRange++; updateAirUI(); }
});
$('airNear').addEventListener('click', async () => {
  if (airRange <= 1) { toast('Bu eng yaqin masofa'); return; }
  if (await addPadRoute(airRange - 1)) { airRange--; updateAirUI(); }
});

// ---------- Asboblar ----------
function setTool(next) {
  tool = next;
  if (next === 'air') drawAir();   // to'siqlar o'zgargan bo'lishi mumkin: yo'llarni qayta tekshiramiz
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== next; });
  if (next !== 'select') selectEntry(null);
  if (next !== 'air' && airPadMode) { airPadMode = false; drawAir(); }   // joy belgilash rejimi havo panelidan chiqqanda o'chadi
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
  const isGlb = !!CATALOG[entry.data.t].glb;
  if (act === 'rotL') actOnSelected((e) => { e.data.r -= Math.PI / 12; });
  else if (act === 'rotR') actOnSelected((e) => { e.data.r += Math.PI / 12; });
  else if ((act === 'hUp' || act === 'hDown') && isGlb) {
    const next = Math.round(((entry.data.y || 0) + (act === 'hUp' ? GLB_HOUSE.yStep : -GLB_HOUSE.yStep)) * 10) / 10;
    if (next < GLB_HOUSE.yMin || next > GLB_HOUSE.yMax) { toast(`Balandlik ${GLB_HOUSE.yMin} .. ${GLB_HOUSE.yMax} m oralig‘ida bo‘ladi`); return; }
    actOnSelected((e) => { e.data.y = next; });
  }
  else if (act === 'hUp' || act === 'hDown') {
    const min = CATALOG[entry.data.t].rise === 0 ? RAMP_STEP : 0;
    const next = (entry.data.y || 0) + (act === 'hUp' ? RAMP_STEP : -RAMP_STEP);
    if (next < min || next > RAMP_MAX) { toast(next < min ? `Bu yo‘l ${min} m dan past bo‘lmaydi` : `Balandlik ${RAMP_MAX} m dan oshmaydi`); return; }
    actOnSelected((e) => { e.data.y = next; });
  }
  else if (act === 'smaller') actOnSelected((e) => { e.data.s = Math.max(isGlb ? GLB_HOUSE.sMin : 0.4, e.data.s / 1.1); });
  else if (act === 'bigger') actOnSelected((e) => { e.data.s = Math.min(isGlb ? GLB_HOUSE.sMax : 3, e.data.s * 1.1); });
  else if (act === 'tint') actOnSelected((e) => { e.data.c = (e.data.c + 1) % TINTS[kind].length; });
  else if (act === 'bend') actOnSelected((e) => { e.data.bend = ((e.data.bend || 0) + 2) % 3 - 1; });   // to'g'ri → o'ng → chap → to'g'ri
  else if (act === 'dup') {
    if (entries.length >= MAX_OBJECTS) { toast('Obyektlar soni chegaraga yetdi'); return; }
    if (entry.data.t === 'spawn') { toast('Boshlanish nuqtasi faqat bitta bo‘ladi'); return; }
    pushUndo();
    const copyData = { ...entry.data, x: clampX(entry.data.x + 6), z: clampZ(entry.data.z + 6) };
    if (copyData.lights) copyData.lights = copyData.lights.map((l) => ({ ...l }));
    const copy = addEntry(copyData);
    selectEntry(copy.id);
    scheduleSave();
  } else if (act === 'del') {
    pushUndo();
    removeEntry(entry);
    scheduleSave();
  }
});

// ---------- GLB uy paneli: kattalik va balandlik (slayder, ±, barmoq bilan tortish) ----------
const GLB_MODE_HINT = {
  move: 'Uyni barmoq bilan bosib ushlab suring. Kattalik va balandlik uchun slayder yoki tugmalardan foydalaning.',
  size: 'Ekranning istalgan joyidan barmoqni yuqoriga tortsangiz uy kattalashadi, pastga tortsangiz kichrayadi.',
  height: 'Ekranning istalgan joyidan barmoqni yuqoriga tortsangiz uy ko‘tariladi, pastga tortsangiz tushadi.',
};
let glbSliderPushed = false;
function updateGlbPanel(entry, isGlb) {
  const panel = $('glbPanel');
  if (!panel) return;
  panel.hidden = !isGlb;
  if (!isGlb) { glbDragMode = 'move'; return; }
  const d = entry.data;
  $('glbSize').value = String(Math.round(d.s * 100));
  $('glbHeight').value = String(d.y || 0);
  $('glbSizeOut').textContent = `×${d.s.toFixed(2)} (${(2 * (d.w || 5) * d.s).toFixed(1)} × ${(2 * (d.d || 5) * d.s).toFixed(1)} m)`;
  $('glbHeightOut').textContent = `${(d.y || 0).toFixed(1)} m`;
  const deg = Math.round((((d.r * 180) / Math.PI) % 360 + 360) % 360);
  $('glbRot').value = String(deg);
  $('glbRotOut').textContent = `${deg}°`;
  panel.querySelectorAll('[data-glbmode]').forEach((b) => b.classList.toggle('is-active', b.dataset.glbmode === glbDragMode));
  $('glbModeHint').textContent = GLB_MODE_HINT[glbDragMode];
}
function glbApply(fn, undoOnce) {
  const entry = getEntry(selectedId);
  if (!entry || !CATALOG[entry.data.t].glb) return;
  if (!undoOnce || !glbSliderPushed) pushUndo();
  if (undoOnce) glbSliderPushed = true;
  fn(entry);
  refreshEntry(entry);
  scheduleSave();
}
const glbClampS = (v) => Math.min(GLB_HOUSE.sMax, Math.max(GLB_HOUSE.sMin, Math.round(v * 1000) / 1000));
const glbClampY = (v) => Math.min(GLB_HOUSE.yMax, Math.max(GLB_HOUSE.yMin, Math.round(v * 10) / 10));
$('glbSize').addEventListener('input', () => glbApply((e) => { e.data.s = glbClampS(Number($('glbSize').value) / 100); }, true));
$('glbHeight').addEventListener('input', () => glbApply((e) => { e.data.y = glbClampY(Number($('glbHeight').value)); }, true));
$('glbRot').addEventListener('input', () => glbApply((e) => { e.data.r = (Number($('glbRot').value) * Math.PI) / 180; }, true));
$('glbRot').addEventListener('change', () => { glbSliderPushed = false; });
$('glbRotMinus').addEventListener('click', () => glbApply((e) => { e.data.r -= Math.PI / 36; }));   // 5° chapga
$('glbRotPlus').addEventListener('click', () => glbApply((e) => { e.data.r += Math.PI / 36; }));    // 5° o'ngga
$('glbSize').addEventListener('change', () => { glbSliderPushed = false; });
$('glbHeight').addEventListener('change', () => { glbSliderPushed = false; });
$('glbSizeMinus').addEventListener('click', () => glbApply((e) => { e.data.s = glbClampS(e.data.s / 1.05); }));
$('glbSizePlus').addEventListener('click', () => glbApply((e) => { e.data.s = glbClampS(e.data.s * 1.05); }));
$('glbHeightMinus').addEventListener('click', () => glbApply((e) => { e.data.y = glbClampY((e.data.y || 0) - GLB_HOUSE.yStep); }));
$('glbHeightPlus').addEventListener('click', () => glbApply((e) => { e.data.y = glbClampY((e.data.y || 0) + GLB_HOUSE.yStep); }));
$('glbPanel').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-glbmode]');
  if (!btn) return;
  glbDragMode = btn.dataset.glbmode;
  updateSelInfo();
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
  const hits = raycaster.intersectObjects(entries.map((e) => e.mesh), true);
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
  gesture = { sx: ev.clientX, sy: ev.clientY, moved: false, drag: null, lightDrag: null };
  const entry = selectedId != null ? getEntry(selectedId) : null;
  if (tool === 'select' && entry && CATALOG[entry.data.t].kind === 'traffic_light' && lightDragColor) {
    // Chiroqni tanlab olib qo'ygandan keyin, ekranning istalgan joyidan tortib surish mumkin (joyi muhim emas).
    const i = TRAFFIC_LIGHT_COLORS.indexOf(lightDragColor);
    const l = entry.data.lights[i];
    gesture.lightDrag = { i, startDx: l.dx, startDy: l.dy, pushed: false };
  } else if (tool === 'select' && entry && CATALOG[entry.data.t].glb && glbDragMode !== 'move') {
    // GLB uy: ekranning istalgan joyidan yuqoriga/pastga tortib kattalik yoki balandlikni o'zgartirish
    gesture.adjust = { mode: glbDragMode, s0: entry.data.s, y0: entry.data.y || 0, pushed: false };
  } else if (tool === 'select' && selectedId != null && pickEntryId(ev) === selectedId) {
    const gp = groundPoint(ev);
    if (gp && entry) gesture.drag = { dx: entry.data.x - gp.x, dz: entry.data.z - gp.z, pushed: false };
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!gesture || pointers.size > 1) return;
  if (!gesture.moved && Math.hypot(ev.clientX - gesture.sx, ev.clientY - gesture.sy) > 8) gesture.moved = true;
  if (gesture.lightDrag && gesture.moved) {
    const entry = getEntry(selectedId);
    if (!entry) return;
    if (!gesture.lightDrag.pushed) { pushUndo(); gesture.lightDrag.pushed = true; }
    const k = 0.015;   // ekran pikselini metrga aylantirish tezligi
    const dx = (ev.clientX - gesture.sx) * k;
    const dy = -(ev.clientY - gesture.sy) * k;
    const l = entry.data.lights[gesture.lightDrag.i];
    l.dx = Math.max(TRAFFIC_HEAD.minDx, Math.min(TRAFFIC_HEAD.maxDx, gesture.lightDrag.startDx + dx));
    l.dy = Math.max(TRAFFIC_HEAD.minDy, Math.min(TRAFFIC_HEAD.maxDy, gesture.lightDrag.startDy + dy));
    refreshEntry(entry);
    return;
  }
  if (gesture.adjust && gesture.moved) {
    const entry = getEntry(selectedId);
    if (!entry) return;
    if (!gesture.adjust.pushed) { pushUndo(); gesture.adjust.pushed = true; }
    const up = gesture.sy - ev.clientY;   // yuqoriga tortilsa musbat
    if (gesture.adjust.mode === 'size') {
      entry.data.s = Math.min(GLB_HOUSE.sMax, Math.max(GLB_HOUSE.sMin, Math.round(gesture.adjust.s0 * Math.exp(up * 0.006) * 1000) / 1000));
    } else {
      entry.data.y = Math.min(GLB_HOUSE.yMax, Math.max(GLB_HOUSE.yMin, Math.round((gesture.adjust.y0 + up * 0.05) * 2) / 2));
    }
    refreshEntry(entry);
    return;
  }
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
  if (g.lightDrag && g.moved) { scheduleSave(); return; }
  if (g.drag && g.moved) { scheduleSave(); return; }
  if (g.adjust && g.moved) { scheduleSave(); return; }
  if (g.moved || ev.type === 'pointercancel') return;
  if (tool === 'place') {
    const gp = groundPoint(ev);
    if (gp) placeAt(gp.x, gp.z);
  } else if (tool === 'air') {
    const gp = groundPoint(ev);
    if (gp) addAirPoint(gp.x, gp.z);
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
    loadAir(zone.air);
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
  loadAir(zone.air);
  scheduleSave();
  sheet.hidden = true;
  toast('Serverdagi zona yuklandi');
});

// ---------- Ishga tushirish ----------
const startZone = loadZone() || (await fetchSharedZone()) || defaultZone();
setBounds(startZone.bounds);
homeView();
for (const o of startZone.objects) addEntry(normalizeObject(o));
loadAir(startZone.air);
updateStatus();
updateSelInfo();

renderer.setAnimationLoop((now) => {
  controls.update();
  if (helper) helper.update();
  const t = now / 1000;
  for (const e of entries) {
    if (CATALOG[e.data.t].kind === 'traffic_light') updateTrafficLightGroup(e.mesh, e.data, t);
  }
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