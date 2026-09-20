import * as THREE from 'three';
import {
  CATALOG, HALF, ZONE_SIZE, loadSettings, loadZone, defaultZone, normalizeObject,
  makeCollider, collideCircle, fetchSharedZone, fetchCarList, loadSelectedCarName,
  CAR_DEFAULTS, cameraPose, loadCarDraft,
} from './data.js';
import {
  getGeometry, getMaterial, tintColor, loadCity, loadCarModel, makeEnvironment,
} from './models.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
// Hamma o'yinchilar egasi qurgan zone.json da o'ynaydi. ?draft=1 faqat egasining qoralamasini sinash uchun.
const useDraft = new URLSearchParams(location.search).has('draft');
const zone = (useDraft ? loadZone() : null) || (await fetchSharedZone()) || defaultZone();
const objects = zone.objects.map(normalizeObject);

// ---------- Renderer ----------
const canvas = $('scene');
const quality = settings.quality;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', '<p class="fatal">Brauzeringiz 3D (WebGL) ni qo‘llamayapti.</p>');
  throw err;
}
const pixelRatio = { low: 1, medium: Math.min(devicePixelRatio, 1.5), high: Math.min(devicePixelRatio, 2) }[quality] || 1;
renderer.setPixelRatio(pixelRatio);
const shadowsOn = settings.shadows && quality !== 'low';
renderer.shadowMap.enabled = shadowsOn;
renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

const scene = new THREE.Scene();
const SKY = '#a9d0ea';
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 340);

scene.environment = makeEnvironment(renderer);   // faqat PBR (mashina) materiallariga ta'sir qiladi

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 700);

// ---------- Yorug'lik ----------
scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x6f7a55, 1.05));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
if (shadowsOn) {
  sun.castShadow = true;
  const size = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(size, size);
  const c = sun.shadow.camera;
  c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 10; c.far = 220;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
}
scene.add(sun, sun.target);

// ---------- Yer ----------
const groundOuter = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#5f8a49' }),
);
groundOuter.position.y = -0.05;
scene.add(groundOuter);

const groundZone = new THREE.Mesh(
  new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#6f9a55' }),
);
groundZone.position.y = 0.005;
groundZone.receiveShadow = shadowsOn;
scene.add(groundZone);

// Zona chegarasi: sariq chiziq
const edgeMat = new THREE.MeshBasicMaterial({ color: '#ffc933' });
for (const [w, d, x, z] of [
  [ZONE_SIZE, 0.6, 0, HALF], [ZONE_SIZE, 0.6, 0, -HALF],
  [0.6, ZONE_SIZE, HALF, 0], [0.6, ZONE_SIZE, -HALF, 0],
]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edgeMat);
  m.position.set(x, 0.03, z);
  scene.add(m);
}

// ---------- Zona obyektlari (InstancedMesh: tur boshiga bitta chizish) ----------
const byType = new Map();
for (const o of objects) {
  if (o.t === 'spawn') continue;
  if (!byType.has(o.t)) byType.set(o.t, []);
  byType.get(o.t).push(o);
}
const dummy = new THREE.Object3D();
for (const [type, list] of byType) {
  const kind = CATALOG[type].kind;
  const mesh = new THREE.InstancedMesh(getGeometry(type), getMaterial(kind, 0), list.length);
  list.forEach((o, i) => {
    dummy.position.set(o.x, 0, o.z);
    dummy.rotation.set(0, o.r, 0);
    dummy.scale.setScalar(o.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tintColor(kind, o.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = shadowsOn && kind !== 'road';
  mesh.receiveShadow = shadowsOn;
  scene.add(mesh);
}
const colliders = objects.map(makeCollider).filter(Boolean);

// ---------- Mashina modeli ----------
function buildCar() {
  const group = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  const bodyMat = lambert('#d9432f');
  const glassMat = lambert('#20303f');
  const darkMat = lambert('#15181d');
  const rimMat = lambert('#c9ced6');
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff4c2' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff3b30' });

  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadowsOn;
    parent.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(1.9, 0.7, 4.4), bodyMat, 0, 0.75, 0);
  add(new THREE.BoxGeometry(1.7, 0.62, 2.2), glassMat, 0, 1.4, -0.3);
  add(new THREE.BoxGeometry(1.74, 0.08, 2.0), bodyMat, 0, 1.75, -0.3);
  add(new THREE.BoxGeometry(1.95, 0.25, 0.16), darkMat, 0, 0.55, 2.2);
  add(new THREE.BoxGeometry(1.95, 0.25, 0.16), darkMat, 0, 0.55, -2.2);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.42, 0.2, 0.06), headMat, sx * 0.65, 0.88, 2.22);
    add(new THREE.BoxGeometry(0.42, 0.2, 0.06), tailMat, sx * 0.65, 0.88, -2.22);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10).rotateZ(Math.PI / 2);
  const wheels = [], pivots = [];
  for (const [sx, sz] of [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.98, 0.38, sz);
    group.add(pivot);
    const wheel = add(wheelGeo, darkMat, 0, 0, 0, pivot);
    add(hubGeo, rimMat, 0, 0, 0, wheel);
    wheels.push(wheel);
    if (sz > 0) pivots.push(pivot);
  }
  return { group, wheels, frontPivots: pivots };
}
// carRoot: joyi va yo'nalishi; carTilt: engashish (tormozda old tomon cho'kadi, burilishda yon tomonga egiladi)
const carRoot = new THREE.Group();
const carTilt = new THREE.Group();
carRoot.add(carTilt);
scene.add(carRoot);
let carModel = { wheels: [], frontPivots: [] };
let carProfile = { ...CAR_DEFAULTS };   // tanlangan mashinaning kamera va o'lcham sozlamalari (car.txt)

function useFallbackCar() {
  const built = buildCar();
  carTilt.add(built.group);
  carModel = built;
}

// Tanlangan mashina (car.txt dagi nom bo'yicha). Topilmasa birinchi mashina, u ham bo'lmasa oddiy quti mashina.
async function setupCar(setText, setProgress) {
  const cars = await fetchCarList();
  const wanted = loadSelectedCarName();
  let entry = cars.find((c) => c.name === wanted) || cars[0] || null;
  if (entry && useDraft) entry = { ...entry, ...loadCarDraft(entry.name) };   // egasining sinov qoralamasi
  if (entry) {
    carProfile = entry;
    setText(`Mashina yuklanmoqda: ${entry.name}…`);
    try {
      const model = await loadCarModel(entry, setProgress);
      model.traverse((o) => { if (o.isMesh) o.castShadow = shadowsOn; });
      carTilt.add(model);
      return;
    } catch (err) {
      console.warn('Mashina modeli yuklanmadi:', err);
      setText('Mashina fayli topilmadi. Oddiy mashina bilan davom etamiz.');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  useFallbackCar();
}

// ---------- Mashina holati va fizikasi ----------
const spawn = objects.find((o) => o.t === 'spawn') || { x: 0, z: 0, r: 0 };
const car = { x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0 };
const CAR = {
  maxSpeed: 42, reverseMax: 12, accel: 18, brake: 34, radius: 1.05,
  circles: [1.4, 0, -1.4],
};
let camHeading = 0;

function respawn() {
  car.x = spawn.x; car.z = spawn.z; car.h = spawn.r;
  car.vx = 0; car.vz = 0; car.steer = 0;
  camHeading = car.h;
  placeCamera(true);
}

const input = { left: false, right: false, gas: false, brake: false, hand: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function stepCar(dt) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -Math.cos(car.h), rz = Math.sin(car.h);    // mashinaning o'ng tomoni
  let vf = car.vx * fx + car.vz * fz;
  let vr = car.vx * rx + car.vz * rz;

  if (input.gas) {
    if (vf < -0.5) vf += CAR.brake * dt;
    else vf += CAR.accel * (1 - clamp(vf / CAR.maxSpeed, 0, 1)) * dt;
  } else if (input.brake) {
    if (vf > 0.5) vf -= CAR.brake * dt;
    else vf -= 10 * (1 - clamp(-vf / CAR.reverseMax, 0, 1)) * dt;
  } else {
    const drag = (3 + Math.abs(vf) * 0.05) * dt;
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag);
  }
  vf -= vf * Math.abs(vf) * 0.0018 * dt;                 // havo qarshiligi
  if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 14 * dt);

  vr *= Math.exp(-(input.hand ? 1.6 : 9) * dt);          // yon sirpanish; qo'l tormozida drift

  const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steer += (target - car.steer) * Math.min(1, dt * 7);
  const speedFactor = clamp(Math.abs(vf) / 5, 0, 1);
  const highSpeed = 1 - 0.55 * clamp(Math.abs(vf) / CAR.maxSpeed, 0, 1);
  let yaw = car.steer * 1.9 * settings.sensitivity * speedFactor * highSpeed * (vf >= 0 ? 1 : -1);
  if (input.hand) yaw *= 1.35;
  car.h -= yaw * dt;                                      // o'ngga burilish = burchak kamayadi

  const nfx = Math.sin(car.h), nfz = Math.cos(car.h);
  const nrx = -Math.cos(car.h), nrz = Math.sin(car.h);
  car.vx = nfx * vf + nrx * vr;
  car.vz = nfz * vf + nrz * vr;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  resolveCollisions();

  const lim = HALF - 2;
  if (car.x > lim) { car.x = lim; if (car.vx > 0) car.vx *= -0.2; }
  if (car.x < -lim) { car.x = -lim; if (car.vx < 0) car.vx *= -0.2; }
  if (car.z > lim) { car.z = lim; if (car.vz > 0) car.vz *= -0.2; }
  if (car.z < -lim) { car.z = -lim; if (car.vz < 0) car.vz *= -0.2; }
}

function resolveCollisions() {
  for (let pass = 0; pass < 2; pass++) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    for (const off of CAR.circles) {
      const cx = car.x + fx * off, cz = car.z + fz * off;
      for (const col of colliders) {
        const dx = cx - col.x, dz = cz - col.z;
        if (dx * dx + dz * dz > col.reach2) continue;
        const hit = collideCircle(col, cx, cz, CAR.radius);
        if (!hit) continue;
        car.x += hit.nx * hit.pen;
        car.z += hit.nz * hit.pen;
        const vn = car.vx * hit.nx + car.vz * hit.nz;
        if (vn < 0) {                                     // to'siq ichiga kirayotgan tezlikni qaytaramiz
          car.vx -= 1.15 * vn * hit.nx;
          car.vz -= 1.15 * vn * hit.nz;
        }
      }
    }
  }
}

// ---------- Kamera ----------
function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
const desiredCam = new THREE.Vector3();
function placeCamera(snap, dt = 0.016) {
  const p = carProfile;
  camHeading = snap ? car.h : lerpAngle(camHeading, car.h, 1 - Math.exp(-dt * p.follow * 0.56));
  const speed = Math.hypot(car.vx, car.vz);
  // Kamera formulasi data.js da: car-editor.html dagi ko'rinish bilan aynan bir xil
  const pose = cameraPose(p, car.x, car.z, camHeading, speed, settings.cameraDistance - 11);
  desiredCam.set(pose.px, pose.py, pose.pz);
  if (snap) camera.position.copy(desiredCam);
  else camera.position.lerp(desiredCam, 1 - Math.exp(-dt * p.follow));
  camera.lookAt(pose.lx, pose.ly, pose.lz);
  if (Math.abs(camera.fov - pose.fov) > 0.05) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
}

// ---------- Boshqaruv ----------
function bindHold(el, key) {
  const down = (e) => {
    e.preventDefault();
    input[key] = true;
    el.classList.add('is-down');
    try { el.setPointerCapture(e.pointerId); } catch { /* ba'zi brauzerlarda kerak emas */ }
  };
  const up = () => { input[key] = false; el.classList.remove('is-down'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
document.querySelectorAll('.ctl').forEach((el) => bindHold(el, el.dataset.key));

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'hand',
};
addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'KeyR') respawn();
  else if (e.code === 'Escape') setPaused(!paused);
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });

// ---------- Pauza ----------
let paused = false;
function setPaused(value) {
  paused = value;
  $('pause').hidden = !value;
  if (value) for (const k of Object.keys(input)) input[k] = false;
  document.querySelectorAll('.ctl.is-down').forEach((el) => el.classList.remove('is-down'));
}
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('respawnBtn').addEventListener('click', () => { respawn(); setPaused(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// ---------- Radar ----------
const mm = $('minimap');
const mctx = mm.getContext('2d');
const RADAR_RADIUS = 70;   // metr
function sizeMinimap() {
  const css = mm.clientWidth || 132;
  mm.width = Math.round(css * pixelRatio);
  mm.height = mm.width;
}
function drawMinimap() {
  const size = mm.width, k = size / (2 * RADAR_RADIUS);
  const s = Math.sin(car.h), c = Math.cos(car.h);
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, size, size);
  mctx.save();
  mctx.beginPath();
  mctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  mctx.clip();
  mctx.fillStyle = '#4d6b3b';
  mctx.fillRect(0, 0, size, size);
  // dunyo (x,z) -> ekran; mashina doim tepaga qaragan
  mctx.setTransform(-c * k, -s * k, s * k, -c * k, size / 2, size / 2);
  mctx.translate(-car.x, -car.z);
  const reach = RADAR_RADIUS * 1.6;
  for (const pass of ['road', 'house', 'tree']) {
    for (const o of objects) {
      const def = CATALOG[o.t];
      if (def.kind !== pass) continue;
      if (Math.abs(o.x - car.x) > reach || Math.abs(o.z - car.z) > reach) continue;
      if (pass === 'tree') {
        mctx.fillStyle = '#2e6b3f';
        mctx.beginPath();
        mctx.arc(o.x, o.z, 2.2 * o.s, 0, Math.PI * 2);
        mctx.fill();
      } else {
        mctx.save();
        mctx.translate(o.x, o.z);
        mctx.rotate(-o.r);
        mctx.fillStyle = pass === 'road' ? '#3a3f47' : '#e9dcc3';
        mctx.fillRect(-def.hw * o.s, -def.hd * o.s, def.hw * o.s * 2, def.hd * o.s * 2);
        mctx.restore();
      }
    }
  }
  mctx.restore();
  // mashina belgisi
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  const u = size / 22;
  mctx.fillStyle = '#ffc933';
  mctx.beginPath();
  mctx.moveTo(size / 2, size / 2 - u * 1.4);
  mctx.lineTo(size / 2 + u, size / 2 + u);
  mctx.lineTo(size / 2, size / 2 + u * 0.4);
  mctx.lineTo(size / 2 - u, size / 2 + u);
  mctx.closePath();
  mctx.fill();
}

// ---------- Hajm va sikl ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sizeMinimap();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

const speedEl = $('speedValue');
const fpsEl = $('fps');
fpsEl.hidden = !settings.showFps;
let last = performance.now(), fpsAcc = 0, fpsFrames = 0, shownSpeed = -1;
let prevVf = 0, tiltPitch = 0, tiltRoll = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!paused) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < steps; i++) stepCar(dt / steps);

    const speed = Math.hypot(car.vx, car.vz);
    const vf = car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);
    carRoot.position.set(car.x, 0, car.z);
    carRoot.rotation.y = car.h;

    const acc = (vf - prevVf) / Math.max(dt, 0.001);
    prevVf = vf;
    const ease = Math.min(1, dt * 6);
    const tiltK = carProfile.tilt;
    tiltPitch += (clamp(-acc * 0.0035, -0.05, 0.05) * tiltK - tiltPitch) * ease;
    tiltRoll += (clamp(-car.steer * clamp(Math.abs(vf) / 20, 0, 1) * 0.05, -0.05, 0.05) * tiltK - tiltRoll) * ease;
    carTilt.rotation.set(tiltPitch, 0, tiltRoll);

    for (const w of carModel.wheels) w.rotation.x += (vf * dt) / 0.38;
    for (const p of carModel.frontPivots) p.rotation.y = -car.steer * 0.5;

    placeCamera(false, dt);
    sun.position.set(car.x + 40, 70, car.z + 25);
    sun.target.position.set(car.x, 0, car.z);

    const kmh = Math.round(speed * 3.6);
    if (kmh !== shownSpeed) { shownSpeed = kmh; speedEl.textContent = kmh; }
    drawMinimap();
  }

  renderer.render(scene, camera);

  if (settings.showFps) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`; fpsAcc = 0; fpsFrames = 0; }
  }
}

// ---------- Ishga tushirish ----------
async function start() {
  const loadingText = $('loadingText'), bar = $('loadingBar');
  await setupCar(
    (text) => { loadingText.textContent = text; },
    (p) => { bar.style.width = `${Math.round(8 + p * 92)}%`; },
  );
  respawn();

  if (settings.useCityModel) {
    loadingText.textContent = 'Shahar modeli yuklanmoqda (90 MB)…';
    try {
      const city = await loadCity((p) => { bar.style.width = `${Math.round(8 + p * 92)}%`; });
      scene.add(city);
    } catch (err) {
      console.warn('Shahar modeli yuklanmadi:', err);
      loadingText.textContent = 'Shahar modeli topilmadi (assets/procedural_city_6.glb). Zona bilan davom etamiz.';
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  bar.style.width = '100%';
  renderer.setAnimationLoop(frame);
  setTimeout(() => { $('loading').hidden = true; }, 250);
}
start();
