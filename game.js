import * as THREE from 'three';
import {
  CATALOG, HALF, ZONE_SIZE, loadSettings, saveSettings, loadZone, defaultZone, normalizeObject,
  makeCollider, collideCircle, fetchSharedZone, fetchCarList, loadSelectedCarName,
  CAR_DEFAULTS, cameraPose, loadCarDraft, BILLBOARD_SCREEN, fetchBillboardList, normalizeBounds, fetchWeather,
  makeRamp, groundHeightAt, rampSurfaceNear,
  buildRoutes, pointOnRoute, LANE_OFFSET, stepBot, fetchBotConfig,
} from './data.js';
import {
  getGeometry, getMaterial, tintColor, loadCity, loadCarModel, makeEnvironment,
} from './models.js';
import { createWeather } from './weather.js';
import { createCarLights } from './lights.js';
import { createBotFleet } from './botFleet.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const useDraft = new URLSearchParams(location.search).has('draft');
const zone = (useDraft ? loadZone() : null) || (await fetchSharedZone()) || defaultZone();
const bounds = normalizeBounds(zone.bounds);
const boundsW = bounds.w + bounds.e, boundsD = bounds.n + bounds.s;
const boundsCX = (bounds.e - bounds.w) / 2, boundsCZ = (bounds.s - bounds.n) / 2;
const objects = zone.objects.map(normalizeObject);
const weatherConfig = await fetchWeather();

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

scene.environment = makeEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 700);

// ---------- Yorug'lik ----------
const hemi = new THREE.HemisphereLight(0xe6f1ff, 0x6f7a55, 1.05);
scene.add(hemi);
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

// ---------- Ob-havo ----------
const weather = createWeather({ scene, camera, renderer, quality, config: weatherConfig, hemi, sun });
const SNOW_MAX = { road: 0.3, ramp: 0.3, land: 0.5, billboard: 0.8 };

// ---------- Yer ----------
const groundOuter = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#5f8a49' }),
);
groundOuter.position.y = -0.05;
weather.patch(groundOuter.material);
scene.add(groundOuter);

const groundZone = new THREE.Mesh(
  new THREE.PlaneGeometry(boundsW, boundsD).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: '#6f9a55' }),
);
groundZone.position.set(boundsCX, 0.005, boundsCZ);
groundZone.receiveShadow = shadowsOn;
weather.patch(groundZone.material);
scene.add(groundZone);

// Zona chegarasi
const edgeMat = new THREE.MeshBasicMaterial({ color: '#ffc933' });
for (const [w, d, x, z] of [
  [boundsW, 0.6, boundsCX, bounds.s], [boundsW, 0.6, boundsCX, -bounds.n],
  [0.6, boundsD, bounds.e, boundsCZ], [0.6, boundsD, -bounds.w, boundsCZ],
]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edgeMat);
  m.position.set(x, 0.03, z);
  scene.add(m);
}

// ---------- Zona obyektlari ----------
const byType = new Map();
for (const o of objects) {
  if (o.t === 'spawn' || o.t === 'route_point') continue;
  const key = CATALOG[o.t].kind === 'ramp' ? `${o.t}:${o.y || 0}` : o.t;
  if (!byType.has(key)) byType.set(key, []);
  byType.get(key).push(o);
}
const dummy = new THREE.Object3D();
for (const list of byType.values()) {
  const type = list[0].t;
  const kind = CATALOG[type].kind;
  const mat = getMaterial(kind, 0);
  weather.patch(mat, { snowMax: SNOW_MAX[kind] ?? 1, sway: kind === 'tree' });
  const mesh = new THREE.InstancedMesh(getGeometry(type, list[0].y || 0), mat, list.length);
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
  mesh.castShadow = shadowsOn && kind !== 'road' && kind !== 'land';
  mesh.receiveShadow = shadowsOn;
  scene.add(mesh);
}
const colliders = objects.map(makeCollider).filter(Boolean);
const ramps = objects.map(makeRamp).filter(Boolean);
const routes = buildRoutes(objects);

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

// ---------- Botlar (haqiqiy GLB modellar, InstancedMesh) ----------
let fleet = null;
let botCfg = null;

async function setupBots(setText) {
  if (!routes.length) return;
  botCfg = await fetchBotConfig();
  if (!botCfg.count) return;

  const cars = await fetchCarList();
  const botCars = cars
    .filter(c => !botCfg.bans.has(c.name.toLowerCase()))
    .filter(c => (c.length || 4.6) <= 7)
    .map(c => c.file)
    .slice(0, 4);

  if (!botCars.length) return;

  setText(`Botlar yuklanmoqda (${botCfg.count} ta, ${botCars.length} xil model)…`);
  fleet = await createBotFleet(scene, botCars, Math.min(botCfg.count, 400));
  if (!fleet) { setText('Bot modellari yuklanmadi'); return; }

  const perRoute = routes.map(() => []);
  for (let i = 0; i < botCfg.count; i++) perRoute[i % routes.length].push(i);

  let modelSeed = 0;
  routes.forEach((route, ri) => {
    const list = perRoute[ri];
    list.forEach((_, k) => {
      const s0 = (route.total / Math.max(1, list.length)) * (k + Math.random());
      const start = pointOnRoute(route, s0);
      const bot = fleet.add(start.x, start.z, Math.atan2(start.dirx, start.dirz), route, modelSeed++);
      if (bot) {
        bot.s = s0;
        bot.speed = (botCfg.speedKmh / 3.6) * (0.7 + Math.random() * 0.5);
      }
    });
  });
  setText(`Botlar tayyor: ${fleet.bots.length} (${fleet.modelCount} xil model)`);
}

function updateBots(dt) {
  if (!fleet || !botCfg) return;
  const playerSpeed = Math.hypot(car.vx, car.vz);
  const obstacles = [{ x: car.x, z: car.z, speed: playerSpeed }];

  fleet.update(car.x, car.z, obstacles, botCfg, dt, (bot, stepDt) => {
    bot.s += bot.speed * stepDt;
    const pos = pointOnRoute(bot.route, bot.s);
    const prx = -pos.dirz, prz = pos.dirx;

    bot.lateral += (LANE_OFFSET - bot.lateral) * Math.min(1, stepDt * 2);
    bot.x = pos.x + prx * bot.lateral;
    bot.z = pos.z + prz * bot.lateral;
    bot.heading = Math.atan2(pos.dirx, pos.dirz);

    const dx = bot.x - car.x, dz = bot.z - car.z;
    if (dx * dx + dz * dz < 64) {
      bot.speed = Math.max(0, bot.speed - 15 * stepDt);
    } else {
      const target = botCfg.speedKmh / 3.6;
      bot.speed += (target - bot.speed) * Math.min(1, stepDt * 0.5);
    }
  });
}

function resolveBotCollisions() {
  if (!fleet) return;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  for (const off of CAR.circles) {
    const cx = car.x + fx * off, cz = car.z + fz * off;
    for (const bot of fleet.bots) {
      const dx = cx - bot.x, dz = cz - bot.z;
      const minDist = CAR.radius + 1.2;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, nz = dz / d, pen = minDist - d;
      car.x += nx * pen; car.z += nz * pen;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) { car.vx -= 1.15 * vn * nx; car.vz -= 1.15 * vn * nz; }
      bot.speed = Math.max(0, bot.speed * 0.5);
    }
  }
}

// ---------- O'yinchi mashinasi ----------
const carRoot = new THREE.Group();
const carTilt = new THREE.Group();
carRoot.add(carTilt);
scene.add(carRoot);
let carModel = { wheels: [], frontPivots: [] };
let carProfile = { ...CAR_DEFAULTS };

let carLights = null;
let lightsOn = weather.night;
const lightBtn = $('lightBtn');
function toggleLights() {
  lightsOn = !lightsOn;
  lightBtn.classList.toggle('is-on', lightsOn);
}
lightBtn.addEventListener('click', toggleLights);

function useFallbackCar() {
  const built = buildCar();
  carTilt.add(built.group);
  carModel = built;
}

async function setupCar(setText, setProgress) {
  const cars = await fetchCarList();
  const wanted = loadSelectedCarName();
  let entry = cars.find((c) => c.name === wanted) || cars[0] || null;
  if (entry && useDraft) entry = { ...entry, ...loadCarDraft(entry.name) };
  if (entry) {
    carProfile = entry;
    carLights = createCarLights(entry.lights, { length: entry.length, lift: entry.lift });
    carTilt.add(carLights.group);
    lightBtn.hidden = !carLights.hasButton;
    lightBtn.classList.toggle('is-on', lightsOn);
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

// ---------- Fizika ----------
const spawn = objects.find((o) => o.t === 'spawn') || { x: 0, z: 0, r: 0 };
const car = { x: 0, z: 0, y: 0, vy: 0, h: 0, vx: 0, vz: 0, steer: 0 };
const CAR = {
  maxSpeed: 42, reverseMax: 12, accel: 18, brake: 34, radius: 1.05,
  circles: [1.4, 0, -1.4],
};
let camHeading = 0;

function respawn() {
  car.x = spawn.x; car.z = spawn.z; car.h = spawn.r;
  car.vx = 0; car.vz = 0; car.steer = 0;
  car.y = groundHeightAt(ramps, car.x, car.z); car.vy = 0;
  camBaseY = car.y;
  camHeading = car.h;
  placeCamera(true);
}

const input = { left: false, right: false, gas: false, brake: false, hand: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function surfaceSlope(fx, fz) {
  if (!ramps.length) return 0;
  const hf = groundHeightAt(ramps, car.x + fx * 1.4, car.z + fz * 1.4);
  const hr = groundHeightAt(ramps, car.x - fx * 1.4, car.z - fz * 1.4);
  return Math.abs(hf - hr) < 1.0 ? (hf - hr) / 2.8 : 0;
}
function stepVertical(dt) {
  if (!ramps.length) { car.y = 0; car.vy = 0; return; }
  const target = groundHeightAt(ramps, car.x, car.z);
  if (target >= car.y) { car.y = Math.min(target, car.y + 10 * dt); car.vy = 0; }
  else {
    car.vy -= 25 * dt;
    car.y = Math.max(target, car.y + car.vy * dt);
    if (car.y <= target) car.vy = 0;
  }
}

function stepCar(dt) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -Math.cos(car.h), rz = Math.sin(car.h);
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
  vf -= vf * Math.abs(vf) * 0.0018 * dt;
  if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 14 * dt);

  if (ramps.length && car.y - groundHeightAt(ramps, car.x, car.z) < 0.3) {
    vf -= 9.8 * 0.6 * surfaceSlope(fx, fz) * dt;
  }

  if (weather.wind.x || weather.wind.z) {
    const moving = clamp(Math.abs(vf) / 8, 0, 1);
    vf += (weather.wind.x * fx + weather.wind.z * fz) * 0.1 * moving * dt;
    vr += (weather.wind.x * rx + weather.wind.z * rz) * moving * dt;
  }

  vr *= Math.exp(-(input.hand ? 1.6 : 9) * dt);

  const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steer += (target - car.steer) * Math.min(1, dt * 7);
  const speedFactor = clamp(Math.abs(vf) / 5, 0, 1);
  const highSpeed = 1 - 0.55 * clamp(Math.abs(vf) / CAR.maxSpeed, 0, 1);
  let yaw = car.steer * 1.9 * settings.sensitivity * speedFactor * highSpeed * (vf >= 0 ? 1 : -1);
  if (input.hand) yaw *= 1.35;
  car.h -= yaw * dt;

  const nfx = Math.sin(car.h), nfz = Math.cos(car.h);
  const nrx = -Math.cos(car.h), nrz = Math.sin(car.h);
  car.vx = nfx * vf + nrx * vr;
  car.vz = nfz * vf + nrz * vr;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  resolveCollisions();
  resolveBotCollisions();

  const limE = bounds.e - 2, limW = -bounds.w + 2, limS = bounds.s - 2, limN = -bounds.n + 2;
  if (car.x > limE) { car.x = limE; if (car.vx > 0) car.vx *= -0.2; }
  if (car.x < limW) { car.x = limW; if (car.vx < 0) car.vx *= -0.2; }
  if (car.z > limS) { car.z = limS; if (car.vz > 0) car.vz *= -0.2; }
  if (car.z < limN) { car.z = limN; if (car.vz < 0) car.vz *= -0.2; }

  stepVertical(dt);
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
        if (vn < 0) {
          car.vx -= 1.15 * vn * hit.nx;
          car.vz -= 1.15 * vn * hit.nz;
        }
      }
      for (const r of ramps) {
        const dx = cx - r.x, dz = cz - r.z;
        if (dx * dx + dz * dz > r.reach2) continue;
        const hit = collideCircle(r, cx, cz, CAR.radius);
        if (!hit || rampSurfaceNear(r, cx, cz) - car.y <= 0.5) continue;
        car.x += hit.nx * hit.pen;
        car.z += hit.nz * hit.pen;
        const vn = car.vx * hit.nx + car.vz * hit.nz;
        if (vn < 0) {
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
let camBaseY = 0;
function placeCamera(snap, dt = 0.016) {
  const p = carProfile;
  camHeading = snap ? car.h : lerpAngle(camHeading, car.h, 1 - Math.exp(-dt * p.follow * 0.56));
  const speed = Math.hypot(car.vx, car.vz);
  const pose = cameraPose(p, car.x, car.z, camHeading, speed, settings.cameraDistance - 11);
  camBaseY = snap ? car.y : camBaseY + (car.y - camBaseY) * (1 - Math.exp(-dt * 6));
  desiredCam.set(pose.px, pose.py + camBaseY, pose.pz);
  if (snap) camera.position.copy(desiredCam);
  else camera.position.lerp(desiredCam, 1 - Math.exp(-dt * p.follow));
  camera.lookAt(pose.lx, pose.ly + camBaseY, pose.lz);
  if (Math.abs(camera.fov - pose.fov) > 0.05) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
}

// ---------- Boshqaruv ----------
function bindHold(el, key) {
  const down = (e) => {
    e.preventDefault();
    input[key] = true;
    el.classList.add('is-down');
    try { el.setPointerCapture(e.pointerId); } catch { }
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
  else if (e.code === 'KeyL') toggleLights();
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
const RADAR_RADIUS = 70;
const LAND_COLOR = { land_grass: '#3f6b34', land_sand: '#c9b77f', land_dirt: '#7a5f40', land_asphalt: '#454b55' };
const RECT_COLOR = { road: '#3a3f47', ramp: '#59606b', house: '#e9dcc3', ridge: '#8a9580' };
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
  mctx.setTransform(-c * k, -s * k, s * k, -c * k, size / 2, size / 2);
  mctx.translate(-car.x, -car.z);
  const reach = RADAR_RADIUS * 1.6;
  for (const pass of ['land', 'road', 'ramp', 'house', 'ridge', 'mountain', 'tree', 'billboard']) {
    for (const o of objects) {
      const def = CATALOG[o.t];
      if (def.kind !== pass) continue;
      const ext = (def.r || Math.max(def.hw || 0, def.hd || 0)) * o.s;
      if (Math.abs(o.x - car.x) > reach + ext || Math.abs(o.z - car.z) > reach + ext) continue;
      if (pass === 'tree' || pass === 'mountain') {
        mctx.fillStyle = pass === 'tree' ? '#2e6b3f' : '#8a9580';
        mctx.beginPath();
        mctx.arc(o.x, o.z, (pass === 'tree' ? 2.2 : def.r) * o.s, 0, Math.PI * 2);
        mctx.fill();
      } else if (pass === 'billboard') {
        mctx.save();
        mctx.translate(o.x, o.z);
        mctx.rotate(-o.r);
        mctx.fillStyle = '#4b7bec';
        mctx.fillRect(-6 * o.s, -0.9 * o.s, 12 * o.s, 1.8 * o.s);
        mctx.restore();
      } else {
        mctx.save();
        mctx.translate(o.x, o.z);
        mctx.rotate(-o.r);
        mctx.fillStyle = pass === 'land' ? (LAND_COLOR[o.t] || '#6f8f58') : (RECT_COLOR[pass] || '#e9dcc3');
        mctx.fillRect(-def.hw * o.s, -def.hd * o.s, def.hw * o.s * 2, def.hd * o.s * 2);
        mctx.restore();
      }
    }
  }
  for (const bot of (fleet?.bots || [])) {
    const dx = bot.x - car.x, dz = bot.z - car.z;
    if (dx * dx + dz * dz > 3600) continue;
    mctx.fillStyle = '#ff5252';
    mctx.beginPath();
    mctx.arc(bot.x, bot.z, 1.6, 0, Math.PI * 2);
    mctx.fill();
  }
  mctx.restore();
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

// ---------- Reklama ekranlari ----------
const openLink = $('openLink');
const adPlayers = [];
const screens = [];
const ACTIVE_RANGE = 90;
const BUTTON_RANGE = 35;
const SCREEN_ASPECT = BILLBOARD_SCREEN.w / BILLBOARD_SCREEN.h;

function makeAdPlayer(ad) {
  return { ad, video: null, texture: null, mats: [] };
}
function startAd(p) {
  if (!p.video) {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.src = p.ad.video;
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    v.addEventListener('loadedmetadata', () => {
      const va = v.videoWidth / v.videoHeight;
      if (!Number.isFinite(va) || va <= 0) return;
      if (va > SCREEN_ASPECT) { tex.repeat.set(SCREEN_ASPECT / va, 1); tex.offset.set((1 - SCREEN_ASPECT / va) / 2, 0); }
      else { tex.repeat.set(1, va / SCREEN_ASPECT); tex.offset.set(0, (1 - va / SCREEN_ASPECT) / 2); }
    });
    v.addEventListener('playing', () => {
      for (const m of p.mats) { m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true; }
    });
    v.addEventListener('error', () => console.warn('Reklama videosi yuklanmadi:', p.ad.video));
    p.video = v;
    p.texture = tex;
  }
  if (p.video.paused) p.video.play().catch(() => { });
}
function stopAd(p) {
  if (p.video && !p.video.paused) p.video.pause();
}

function setupBillboards(ads) {
  const list = objects.filter((o) => o.t === 'billboard');
  if (!list.length) return;
  const planeGeo = new THREE.PlaneGeometry(BILLBOARD_SCREEN.w, BILLBOARD_SCREEN.h);
  for (const o of list) {
    const ad = ads.length ? ads[o.c % ads.length] : null;
    let player = null;
    if (ad) {
      player = adPlayers.find((p) => p.ad === ad);
      if (!player) { player = makeAdPlayer(ad); adPlayers.push(player); }
    }
    const group = new THREE.Group();
    group.position.set(o.x, 0, o.z);
    group.rotation.y = o.r;
    group.scale.setScalar(o.s);
    const mats = [];
    for (const side of [1, -1]) {
      const mat = new THREE.MeshBasicMaterial({ color: '#20242b' });
      const plane = new THREE.Mesh(planeGeo, mat);
      plane.position.set(0, BILLBOARD_SCREEN.y, side * BILLBOARD_SCREEN.z);
      if (side < 0) plane.rotation.y = Math.PI;
      group.add(plane);
      mats.push(mat);
    }
    scene.add(group);
    if (player) player.mats.push(...mats);
    screens.push({ o, ad, player, mats });
  }
}

let billTimer = 0, shownLink = '';
function updateBillboards(dt) {
  if (!screens.length) return;
  billTimer -= dt;
  if (billTimer > 0) return;
  billTimer = 0.4;
  const sorted = screens
    .map((s) => ({ s, d: Math.hypot(s.o.x - car.x, s.o.z - car.z) }))
    .sort((a, b) => a.d - b.d);

  const want = new Set();
  for (const { s, d } of sorted.slice(0, 2)) if (d < ACTIVE_RANGE && s.player) want.add(s.player);
  for (const p of adPlayers) { if (want.has(p)) startAd(p); else stopAd(p); }

  const near = sorted.find(({ s, d }) => d < BUTTON_RANGE && s.ad && s.ad.button);
  const link = near ? near.s.ad.button : '';
  if (link !== shownLink) {
    shownLink = link;
    if (link) openLink.href = link;
    openLink.hidden = !link;
  }
}

// ---------- Yotiq dizayn ----------
const stageEl = $('stage');
const rotateHint = $('rotateHint');
let rotated = false, hintTimer = 0, hintShown = false;

function stageSize() {
  return rotated ? { w: innerHeight, h: innerWidth } : { w: innerWidth, h: innerHeight };
}
function applyLayout() {
  const next = settings.landscape !== 'off' && innerHeight > innerWidth;
  rotated = next;
  document.body.classList.toggle('is-rotated', next);
  if (next) {
    stageEl.style.width = `${innerHeight}px`;
    stageEl.style.height = `${innerWidth}px`;
    stageEl.style.transform = settings.landscapeSide === 'ccw'
      ? `translateY(${innerHeight}px) rotate(-90deg)`
      : `translateX(${innerWidth}px) rotate(90deg)`;
    if (!hintShown) {
      hintShown = true;
      rotateHint.hidden = false;
      hintTimer = setTimeout(() => { rotateHint.hidden = true; }, 7000);
    }
  } else {
    stageEl.style.width = stageEl.style.height = stageEl.style.transform = '';
    rotateHint.hidden = true;
  }
  document.body.classList.toggle('compact', stageSize().h <= 420);
  $('flipSide2').hidden = !next;
}
function flipSide() {
  settings.landscapeSide = settings.landscapeSide === 'ccw' ? 'cw' : 'ccw';
  saveSettings(settings);
  clearTimeout(hintTimer);
  rotateHint.hidden = true;
  applyLayout();
}
$('flipSide').addEventListener('click', flipSide);
$('flipSide2').addEventListener('click', flipSide);

async function tryLandscapeLock() {
  if (settings.landscape === 'off') return;
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch { }
}
addEventListener('pointerup', tryLandscapeLock, { once: true });

function resize() {
  applyLayout();
  const { w, h } = stageSize();
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
let prevVf = 0, tiltPitch = 0, tiltRoll = 0, tiltSlope = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!paused) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < steps; i++) stepCar(dt / steps);

    const speed = Math.hypot(car.vx, car.vz);
    const vf = car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);
    carRoot.position.set(car.x, car.y, car.z);
    carRoot.rotation.y = car.h;

    const acc = (vf - prevVf) / Math.max(dt, 0.001);
    prevVf = vf;
    const ease = Math.min(1, dt * 6);
    const tiltK = carProfile.tilt;
    tiltPitch += (clamp(-acc * 0.0035, -0.05, 0.05) * tiltK - tiltPitch) * ease;
    tiltRoll += (clamp(-car.steer * clamp(Math.abs(vf) / 20, 0, 1) * 0.05, -0.05, 0.05) * tiltK - tiltRoll) * ease;
    const slopePitch = ramps.length ? -Math.atan(surfaceSlope(Math.sin(car.h), Math.cos(car.h))) : 0;
    tiltSlope += (slopePitch - tiltSlope) * ease;
    carTilt.rotation.set(tiltPitch + tiltSlope, 0, tiltRoll);

    for (const w of carModel.wheels) w.rotation.x += (vf * dt) / 0.38;
    for (const p of carModel.frontPivots) p.rotation.y = -car.steer * 0.5;

    if (carLights) {
      carLights.update({
        brake: (input.brake && vf > 0.5) || input.hand,
        reverse: vf < -0.3 || (input.brake && vf <= 0.5),
        button: lightsOn,
      });
    }

    placeCamera(false, dt);
    sun.position.set(car.x + 40, 70, car.z + 25);
    sun.target.position.set(car.x, 0, car.z);

    const kmh = Math.round(speed * 3.6);
    if (kmh !== shownSpeed) { shownSpeed = kmh; speedEl.textContent = kmh; }
    drawMinimap();
    updateBillboards(dt);
    updateBots(dt);
    weather.update(dt);
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
  await setupBots((text) => { loadingText.textContent = text; });
  setupBillboards(await fetchBillboardList());

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