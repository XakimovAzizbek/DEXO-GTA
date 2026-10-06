import * as THREE from 'three';
import {
  CATALOG, HALF, ZONE_SIZE, loadSettings, saveSettings, loadZone, defaultZone, normalizeObject,
  makeCollider, collideCircle, fetchSharedZone, fetchCarList, loadSelectedCarName,
  CAR_DEFAULTS, cameraPose, loadCarDraft, BILLBOARD_SCREEN, fetchBillboardList, normalizeBounds, fetchWeather,
  makeRamp, groundHeightAt, rampSurfaceNear,
  buildRoutes, pointOnRoute, LANE_OFFSET, stepBot, fetchBotConfig,
  fetchAirportList, loadSelectedAirportName, AIRPORT_DEFAULTS, loadAirportDraft,
} from './data.js';
import {
  getGeometry, getMaterial, tintColor, loadCity, loadCarModel, makeEnvironment,
  buildTrafficLightGroup, updateTrafficLightGroup, loadAirportModel,
} from './models.js';
import { createWeather } from './weather.js';
import { createCarLights } from './lights.js';
import { createBotFleet } from './botFleet.js';
import { unlockCarAudio, updateCarAudio, setCarAudioActive, updateHorn } from './carAudio.js';
import { unlockAirportAudio, updateHeliAudio, updatePlaneAudio, stopAirportAudio } from './airportAudio.js';
import { initRemoteAudio, createRemoteVoice, REMOTE_HEAR_RANGE, playCrashSound } from './remoteAudio.js';
import { MAX_DENTS, measureModel, applyDent, repairModel, disposeCrash, encodeDents, decodeDents } from './crash.js';
// Eslatma: Firebase bu yerda ATAYLAB statik import qilinmagan — game.js offline o'yin (game.html) uchun
// ham ishlatiladi, va u hech qachon online/Firebase'ga muhtoj bo'lmasligi kerak. Shu sababli Firebase
// faqat pastdagi startMultiplayer() chaqirilganda (ya'ni faqat online o'yinda, player-game.js orqali)
// dinamik import qilinadi — offline o'yinchi Firebase kodini umuman yuklamaydi.


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
const trafficLightEntries = [];   // { group, data } — bittalab render qilinadi, chunki har birining chirog'i alohida yonib-o'chadi
for (const o of objects) {
  if (o.t === 'spawn' || o.t === 'route_point') continue;
  if (CATALOG[o.t].kind === 'traffic_light') {
    const group = buildTrafficLightGroup(o);
    group.position.set(o.x, 0, o.z);
    group.rotation.set(0, o.r, 0);
    group.scale.setScalar(o.s);
    group.traverse((m) => { if (m.isMesh) m.castShadow = shadowsOn; });
    scene.add(group);
    trafficLightEntries.push({ group, data: o });
    continue;
  }
  const key = CATALOG[o.t].kind === 'ramp' ? `${o.t}:${o.y || 0}:${o.bend || 0}` : (o.bend ? `${o.t}:${o.bend}` : o.t);
  if (!byType.has(key)) byType.set(key, []);
  byType.get(key).push(o);
}
const dummy = new THREE.Object3D();
for (const list of byType.values()) {
  const type = list[0].t;
  const kind = CATALOG[type].kind;
  const mat = getMaterial(kind, 0);
  weather.patch(mat, { snowMax: SNOW_MAX[kind] ?? 1, sway: kind === 'tree' });
  const mesh = new THREE.InstancedMesh(getGeometry(type, list[0].y || 0, list[0].bend || 0), mat, list.length);
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

// ---------- Vertolyot va samolyot (kod bilan yasalgan, oddiy past-poligonli modellar) ----------
function buildHeli() {
  const group = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  const bodyMat = lambert('#3f6fae');
  const tailMat = lambert('#33578c');
  const glassMat = lambert('#20303f');
  const bladeMat = lambert('#1c1f26');
  const skidMat = lambert('#22262e');

  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadowsOn;
    parent.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(1.7, 1.5, 3.2), bodyMat, 0, 1.1, -0.3);
  add(new THREE.BoxGeometry(1.3, 1.0, 1.2), glassMat, 0, 1.15, 1.3);
  add(new THREE.BoxGeometry(0.5, 0.55, 3.0), tailMat, 0, 1.25, 2.9);
  add(new THREE.BoxGeometry(0.16, 1.0, 0.9), tailMat, 0, 1.9, 4.3);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.15, 0.16, 3.2), skidMat, sx * 0.85, 0.2, -0.3);
  for (const [sx, sz] of [[-0.85, -1.6], [-0.85, 1.0], [0.85, -1.6], [0.85, 1.0]]) {
    add(new THREE.BoxGeometry(0.12, 0.55, 0.12), skidMat, sx, 0.5, sz);
  }

  const rotor = new THREE.Group();
  rotor.position.set(0, 2.1, -0.3);
  add(new THREE.BoxGeometry(0.14, 0.06, 4.2), bladeMat, 0, 0, 0, rotor);
  add(new THREE.BoxGeometry(4.2, 0.06, 0.14), bladeMat, 0, 0, 0, rotor);
  group.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.1, 1.9, 4.35);
  tailRotor.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.06, 0.6, 0.06), bladeMat, 0, 0, 0, tailRotor);
  group.add(tailRotor);

  return { group, wheels: [], frontPivots: [], spin: rotor, spin2: tailRotor };
}

function buildPlane() {
  const group = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  const bodyMat = lambert('#c94f4f');
  const wingMat = lambert('#8a2f2f');
  const glassMat = lambert('#20303f');
  const propMat = lambert('#1c1f26');
  const hubMat = lambert('#3a3f47');

  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadowsOn;
    parent.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(1.1, 1.1, 4.8), bodyMat, 0, 1.0, 0);
  add(new THREE.BoxGeometry(0.85, 0.85, 0.9), bodyMat, 0, 1.0, 2.7);
  add(new THREE.BoxGeometry(0.9, 0.55, 1.3), glassMat, 0, 1.5, 0.2);
  add(new THREE.BoxGeometry(6.6, 0.16, 1.3), wingMat, 0, 1.15, -0.2);
  add(new THREE.BoxGeometry(2.2, 0.14, 0.9), wingMat, 0, 1.35, -2.1);
  add(new THREE.BoxGeometry(0.16, 1.05, 1.0), wingMat, 0, 1.9, -2.15);
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10).rotateX(Math.PI / 2), hubMat, 0, 1.0, 3.1);

  const prop = new THREE.Group();
  prop.position.set(0, 1.0, 3.4);
  add(new THREE.BoxGeometry(0.1, 1.5, 0.05), propMat, 0, 0, 0, prop);
  add(new THREE.BoxGeometry(1.5, 0.1, 0.05), propMat, 0, 0, 0, prop);
  group.add(prop);

  return { group, wheels: [], frontPivots: [], spin: prop };
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

// ---------- Ulov turlari: Mashina / Vertolyot / Samolyot (garajdagi kabi almashtiriladi) ----------
const carGroup = new THREE.Group();     // haqiqiy/fallback mashina shu yerga qo'shiladi
const heliGroup = new THREE.Group();
const planeGroup = new THREE.Group();
carTilt.add(carGroup, heliGroup, planeGroup);
heliGroup.visible = false;
planeGroup.visible = false;
const heliBuilt = buildHeli();
heliGroup.add(heliBuilt.group);
const planeBuilt = buildPlane();
planeGroup.add(planeBuilt.group);
const VEHICLE_GROUPS = { car: carGroup, heli: heliGroup, plane: planeGroup };
const airRoots = { heli: heliBuilt.group, plane: planeBuilt.group };   // hozir ko'rinib turgan model (GLB bo'lsa o'sha) - pachoqlash shunga qo'llanadi
const VEHICLE_SPIN = { heli: [heliBuilt.spin, heliBuilt.spin2], plane: [planeBuilt.spin] };
const VEHICLE_LABEL = { car: 'Mashina', heli: 'Vertolyot', plane: 'Samolyot' };
const VEHICLE_TYPES = {
  car: { maxSpeed: 42, reverseMax: 12, accel: 18, brake: 34, flying: false, maxAlt: Infinity, climb: 0, stall: 0 },
  heli: { maxSpeed: 24, reverseMax: 10, accel: 9, brake: 12, flying: true, maxAlt: 140, climb: 9, stall: 0 },
  plane: { maxSpeed: 55, reverseMax: 8, accel: 8, brake: 10, flying: true, maxAlt: 220, climb: 7, stall: 16 },
};
let vehicleMode = 'car';
let carModel = { wheels: [], frontPivots: [] };
let carProfile = { ...CAR_DEFAULTS };
let airportProfiles = { heli: { ...AIRPORT_DEFAULTS }, plane: { ...AIRPORT_DEFAULTS } };
function currentProfile() {
  if (vehicleMode === 'heli') return airportProfiles.heli;
  if (vehicleMode === 'plane') return airportProfiles.plane;
  return carProfile;
}

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
  carGroup.add(built.group);
  carModel = built;
}

// ---------- Tepa/pastga (uchish) tugmalari (kod bilan yaratiladi) ----------
const flightPad = document.createElement('div');
Object.assign(flightPad.style, {
  position: 'fixed', right: '14px', bottom: '110px', zIndex: 30, display: 'none',
  flexDirection: 'column', gap: '10px',
});
function makeFlightBtn(label, key) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ctl';
  b.dataset.key = key;
  b.textContent = label;
  Object.assign(b.style, {
    width: '56px', height: '56px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.35)',
    background: 'rgba(20,22,28,.72)', color: '#fff', font: '700 20px/1 system-ui, sans-serif', cursor: 'pointer',
  });
  flightPad.appendChild(b);
  return b;
}
const upBtn = makeFlightBtn('▲', 'up');
const downBtn = makeFlightBtn('▼', 'down');
document.body.appendChild(flightPad);

const VEHICLE_ORDER = ['car', 'heli', 'plane'];
const VEHICLE_ICON = { car: '🚗', heli: '🚁', plane: '✈️' };
function setVehicle(mode) {
  if (!VEHICLE_TYPES[mode] || mode === vehicleMode) return;
  const wasFlying = VEHICLE_TYPES[vehicleMode].flying;
  vehicleMode = mode;
  Object.assign(CAR, VEHICLE_TYPES[mode]);
  for (const k of VEHICLE_ORDER) VEHICLE_GROUPS[k].visible = k === mode;
  flightPad.style.display = vehicleMode === 'heli' ? 'flex' : 'none';   // faqat vertolyotda: samolyot balandligi tezlikdan o'zi hisoblanadi
  car.vx = 0; car.vz = 0; car.vy = 0; car.steer = 0;
  if (CAR.flying && !wasFlying) {
    car.y = Math.max(car.y, (ramps.length ? groundHeightAt(ramps, car.x, car.z) : 0) + 6);
  } else if (!CAR.flying && wasFlying) {
    car.y = ramps.length ? groundHeightAt(ramps, car.x, car.z) : 0;
  }
}

async function setupCar(setText, setProgress) {
  const cars = await fetchCarList();
  const wanted = loadSelectedCarName();
  let entry = cars.find((c) => c.name === wanted) || cars[0] || null;
  if (entry && useDraft) entry = { ...entry, ...loadCarDraft(entry.name) };
  if (entry) {
    carProfile = entry;
    carLights = createCarLights(entry.lights, { length: entry.length, lift: entry.lift });
    carGroup.add(carLights.group);
    lightBtn.hidden = !carLights.hasButton;
    lightBtn.classList.toggle('is-on', lightsOn);
    setText(`Mashina yuklanmoqda: ${entry.name}…`);
    try {
      const built = await loadCarModel(entry, setProgress);
      built.group.traverse((o) => { if (o.isMesh) o.castShadow = shadowsOn; });
      carGroup.add(built.group);
      carModel = built;
      return;
    } catch (err) {
      console.warn('Mashina modeli yuklanmadi:', err);
      setText('Mashina fayli topilmadi. Oddiy mashina bilan davom etamiz.');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  useFallbackCar();
}

// Airport.txt dagi tanlangan (yoki mos turdagi birinchi) samolyot/vertolyotni GLB sifatida yuklaydi.
// Muvaffaqiyatsiz bo'lsa, kod bilan yasalgan oddiy model (heliBuilt/planeBuilt) ko'rinishda qoladi.
async function setupAirport(setText, setProgress) {
  const list = await fetchAirportList();
  if (!list.length) return;
  const wanted = loadSelectedAirportName();
  const chosen = list.find((a) => a.name === wanted) || null;
  const byKind = {};
  if (chosen) byKind[chosen.kind] = chosen;
  for (const a of list) if (!byKind[a.kind]) byKind[a.kind] = a;   // boshqa turga (tanlanmagan) birinchi mos yozuv

  const jobs = [
    ['helicopter', 'heli', heliGroup, heliBuilt],
    ['airplane', 'plane', planeGroup, planeBuilt],
  ];
  for (const [kind, mode, group, fallback] of jobs) {
    const entry = byKind[kind];
    if (!entry) continue;
    const draft = useDraft ? loadAirportDraft(entry.name) : {};
    const profile = { ...AIRPORT_DEFAULTS, ...entry, ...draft };
    airportProfiles[mode] = profile;
    setText(`${VEHICLE_LABEL[mode]} yuklanmoqda: ${entry.name}…`);
    try {
      const model = await loadAirportModel(profile, setProgress);
      model.traverse((o) => { if (o.isMesh) o.castShadow = shadowsOn; });
      group.add(model);
      airRoots[mode] = model;
      fallback.group.visible = false;   // GLB muvaffaqiyatli - kod bilan yasalgan zaxira modelni yashiramiz

      // Nomi bo'yicha parrak/rotor qismlarini topib, mavjud aylantirish tizimiga ulaymiz (pastdagi VEHICLE_SPIN).
      const spinNodes = [];
      model.traverse((o) => {
        if (/rotor|propellar|propeller|\bblade\b|\bprop\b/i.test(o.name || '')) spinNodes.push(o);
      });
      if (spinNodes.length) VEHICLE_SPIN[mode] = spinNodes;
    } catch (err) {
      console.warn(`${VEHICLE_LABEL[mode]} modeli yuklanmadi:`, err);
    }
  }
}

// ---------- Fizika ----------
const spawn = objects.find((o) => o.t === 'spawn') || { x: 0, z: 0, r: 0 };
const car = { x: 0, z: 0, y: 0, vy: 0, h: 0, vx: 0, vz: 0, steer: 0 };
const CAR = {
  radius: 1.05, circles: [1.4, 0, -1.4], ...VEHICLE_TYPES.car,
};
let camHeading = 0;

function respawn() {
  repairAllVehicles();
  car.x = spawn.x; car.z = spawn.z; car.h = spawn.r;
  car.vx = 0; car.vz = 0; car.steer = 0;
  car.y = groundHeightAt(ramps, car.x, car.z); car.vy = 0;
  camBaseY = car.y;
  camHeading = car.h;
  placeCamera(true);
}

const input = { steerAxis: 0, gas: false, brake: false, hand: false, up: false, down: false, horn: false };
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

  const target = input.steerAxis;
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

// Uchish fizikasi: vertolyot va samolyot endi boshqacha "his qilinadi" - haqiqiy hayotdagidek.
// Vertolyot: kollektiv (▲▼) to'g'ridan-to'g'ri ko'taradi/tushiradi, joyida ham (tezlik 0 da) to'liq buriladi (hover).
// Samolyot: ko'tarilish uchun tezlik (stall) kerak - sekin bo'lsa burilish zaifroq va balandlik o'zi pasayadi (real stall).
function stepFly(dt) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -Math.cos(car.h), rz = Math.sin(car.h);
  let vf = car.vx * fx + car.vz * fz;
  let vr = car.vx * rx + car.vz * rz;

  if (input.gas) vf += CAR.accel * (1 - clamp(vf / CAR.maxSpeed, 0, 1)) * dt;
  else if (input.brake) vf -= CAR.brake * dt;
  else { const drag = (vehicleMode === 'plane' ? 1.5 : 4) * dt; vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag); }   // samolyot havoda inersiyani ko'proq saqlaydi
  vf = clamp(vf, -CAR.reverseMax, CAR.maxSpeed);

  vr *= Math.exp(-6 * dt);

  const target = input.steerAxis;
  car.steer += (target - car.steer) * Math.min(1, dt * 4);
  // Vertolyot dumaloq rotor tufayli joyida ham to'liq buriladi; samolyotga qanotdan foyda olish uchun tezlik kerak.
  const speedFactor = vehicleMode === 'heli' ? 1 : clamp(Math.abs(vf) / Math.max(1, CAR.stall), 0.15, 1);
  const yaw = car.steer * 1.4 * settings.sensitivity * speedFactor * (vf >= 0 ? 1 : -1);
  car.h -= yaw * dt;

  const nfx = Math.sin(car.h), nfz = Math.cos(car.h);
  const nrx = -Math.cos(car.h), nrz = Math.sin(car.h);
  car.vx = nfx * vf + nrx * vr;
  car.vz = nfz * vf + nrz * vr;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  const limE = bounds.e - 2, limW = -bounds.w + 2, limS = bounds.s - 2, limN = -bounds.n + 2;
  car.x = clamp(car.x, limW, limE);
  car.z = clamp(car.z, limN, limS);

  const ground = ramps.length ? groundHeightAt(ramps, car.x, car.z) : 0;
  let climb = 0, minY;
  if (vehicleMode === 'plane') {
    const lift = clamp(Math.abs(vf) / CAR.stall, 0, 1.3);         // stall tezligidan past bo'lsa ko'tarolmaydi
    climb = (lift - 1) * CAR.climb;                                // tugma yo'q: tezlik oshsa o'zi ko'tariladi, pasaysa o'zi tushadi
    if (lift < 1) climb -= (1 - lift) * 6;                        // real stall: tezlik yetmasa tezroq pasayadi
    minY = ground;                                                 // qo'nish uchun pastki chegara yo'q
  } else {
    if (input.up) climb += CAR.climb;                              // kollektiv: to'g'ridan-to'g'ri ko'tarilish
    if (input.down) climb -= CAR.climb;
    if (input.gas) climb += CAR.climb * 0.35;
    minY = ground + 1.4;                                           // vertolyot doim havoda osilib turadi
  }
  car.y += climb * dt;
  car.y = clamp(car.y, minY, CAR.maxAlt);
  car.vy = 0;
}

function stepVehicle(dt) {
  if (CAR.flying) stepFly(dt); else stepCar(dt);
}

// Mashina/vertolyot/samolyot ovozlarini almashtiradi - faqat ulov turi o'zgarganda eskisini o'chirib, yangisini yoqadi.
let lastAudioMode = null;
function updateVehicleAudio(vf) {
  if (vehicleMode !== lastAudioMode) {
    if (lastAudioMode === 'car') setCarAudioActive(false);
    else if (lastAudioMode === 'heli' || lastAudioMode === 'plane') stopAirportAudio();
    if (vehicleMode === 'car') setCarAudioActive(true);
    lastAudioMode = vehicleMode;
  }
  if (vehicleMode === 'car') {
    updateCarAudio(Math.abs(vf), CAR.maxSpeed, input.gas, (input.brake && vf > 0.5) || input.hand);
    updateHorn(input.horn);
    if (input.horn) hornLatch = true;   // onlayn: qisqa signal ham boshqalarga yetib borsin
  } else if (vehicleMode === 'heli') {
    const climb = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    updateHeliAudio(Math.abs(vf), CAR.maxSpeed, input.gas, climb);
  } else if (vehicleMode === 'plane') {
    updatePlaneAudio(Math.abs(vf), CAR.maxSpeed, input.gas, input.brake);
  }
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
// Kamerani barmoq bilan aylantirish uchun (pastda to'liq tavsif bilan): placeCamera shundan foydalanadi.
let orbitYaw = 0, orbitDragging = false;
// Ikki barmoqli: pinch = yaqin/uzoq (doim eslab qoladi), ikkalasini birga tepaga/pastga tortish =
// vaqtinchalik "yuqoridan qarash" (barmoqni qo'yib yuborsa asl holiga qaytadi).
let zoomOffset = 0, camLift = 0;
function placeCamera(snap, dt = 0.016) {
  const p = currentProfile();
  camHeading = snap ? car.h : lerpAngle(camHeading, car.h, 1 - Math.exp(-dt * p.follow * 0.56));
  const speed = Math.hypot(car.vx, car.vz);
  if (!orbitDragging) {                                   // tez yursa tezroq, to'xtasa sekin - asl holatga qaytadi
    const decay = clamp(speed / 4, 0, 1);
    orbitYaw *= Math.exp(-dt * (0.3 + decay * 3));
  }
  if (pinchPointers.size < 2) camLift *= Math.exp(-dt * 2.2);   // barmoqlar qo'yib yuborilgach asta pasayadi
  const pose = cameraPose(p, car.x, car.z, camHeading + orbitYaw, speed, settings.cameraDistance - 11 + zoomOffset);
  camBaseY = snap ? car.y : camBaseY + (car.y - camBaseY) * (1 - Math.exp(-dt * 6));
  const lift = camLift * 6.5;   // "tepadan qarash" balandligi (metr)
  desiredCam.set(pose.px, pose.py + camBaseY + lift, pose.pz);
  if (snap) camera.position.copy(desiredCam);
  else camera.position.lerp(desiredCam, 1 - Math.exp(-dt * p.follow));
  camera.lookAt(pose.lx, pose.ly + camBaseY - camLift * 1.6, pose.lz);
  if (Math.abs(camera.fov - pose.fov) > 0.05) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
}

// ---------- Kamerani barmoq bilan aylantirish (ekranning yotiq holatdagi YUQORI yarmida) ----------
// Bir barmoq bilan tortib mashinani istalgan tomondan ko'rish mumkin. Tez yursa, kamera o'zi
// avvalgi (orqadan kuzatuvchi) holatga qaytadi - shu bilan haydash chalkashib qolmaydi.
let orbitPointerId = null, orbitStartX = 0, orbitStartY = 0, orbitStartYaw = 0;
const ORBIT_SENS = 0.006;   // piksel boshiga radian

// Ekranning haqiqiy (portret) koordinatasidagi nuqta, yotiq burilish hisobga olingan holda,
// "yotiq ko'rinishning" yuqori yarmida turibdimi - shuni aytadi.
function inOrbitZone(clientX, clientY) {
  if (!rotated) return clientY < innerHeight / 2;
  return settings.landscapeSide === 'ccw' ? clientX < innerWidth / 2 : clientX > innerWidth / 2;
}
// Barmoq surilishini "yotiq ko'rinish"dagi gorizontal (chapga/o'ngga) o'zgarishga aylantiradi.
function orbitAxisDelta(dx, dy) {
  if (!rotated) return dx;
  return settings.landscapeSide === 'ccw' ? -dy : dy;
}
canvas.addEventListener('pointerdown', (e) => {
  if (orbitDragging || !inOrbitZone(e.clientX, e.clientY)) return;
  orbitDragging = true;
  orbitPointerId = e.pointerId;
  orbitStartX = e.clientX; orbitStartY = e.clientY; orbitStartYaw = orbitYaw;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ba'zi brauzerlarda kerak emas */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!orbitDragging || e.pointerId !== orbitPointerId) return;
  const d = orbitAxisDelta(e.clientX - orbitStartX, e.clientY - orbitStartY);
  orbitYaw = orbitStartYaw - d * ORBIT_SENS;
});
function endOrbitDrag(e) {
  if (e.pointerId !== orbitPointerId) return;
  orbitDragging = false;
  orbitPointerId = null;
}
canvas.addEventListener('pointerup', endOrbitDrag);
canvas.addEventListener('pointercancel', endOrbitDrag);

// ---------- Kamera: ikki barmoqli undirish (pinch = yaqin/uzoq, birga tortish = tepadan qarash) ----------
// Ikkita barmoq (chapdan biri, o'ngdan biri) bir-biridan uzoqlashsa - kamera uzoqlashadi (uzoqroqdan ko'radi);
// bir-biriga yaqinlashsa - kamera yaqinlashadi. Ikkalasini birga tepaga tortsa - kamera vaqtincha ko'tarilib,
// yuqoridan qaraydi; qo'yib yuborilsa asl holatiga qaytadi.
const pinchPointers = new Map();     // pointerId -> {x, y}
let pinchStartDist = 0, pinchBaseZoom = 0;
let pinchStartAvgY = 0, pinchBaseLift = 0;
const ZOOM_MIN = -6, ZOOM_MAX = 20;
const ZOOM_SENS = 0.02;              // metr / (barmoqlar orasidagi masofa o'zgarishi, piksel)
const LIFT_SENS = 0.004;             // 0..1 oralig'i / piksel
function pinchGeometry() {
  const [a, b] = [...pinchPointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), avgY: (a.y + b.y) / 2 };
}
canvas.addEventListener('pointerdown', (e) => {
  pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchPointers.size === 2) {
    orbitDragging = false;   // bir barmoqli aylantirish bilan aralashib ketmasin
    const g = pinchGeometry();
    pinchStartDist = g.dist; pinchBaseZoom = zoomOffset;
    pinchStartAvgY = g.avgY; pinchBaseLift = camLift;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pinchPointers.has(e.pointerId)) return;
  pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchPointers.size === 2) {
    const g = pinchGeometry();
    zoomOffset = clamp(pinchBaseZoom + (g.dist - pinchStartDist) * ZOOM_SENS, ZOOM_MIN, ZOOM_MAX);
    camLift = clamp(pinchBaseLift + (pinchStartAvgY - g.avgY) * LIFT_SENS, 0, 1);
  }
});
function endPinchPointer(e) { pinchPointers.delete(e.pointerId); }
canvas.addEventListener('pointerup', endPinchPointer);
canvas.addEventListener('pointercancel', endPinchPointer);

// ---------- Boshqaruv ----------
function bindHold(el, key) {
  const down = (e) => {
    e.preventDefault();
    unlockCarAudio();   // ovoz faqat foydalanuvchi teginganidan keyin ishga tushadi (brauzer talabi)
    unlockAirportAudio();
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

// ---------- Dumaloq rul: ozgina burasan - ozgina buriladi (haqiqiy mashinadagi kabi, chap/o'ng tugma emas) ----------
const wheel = $('wheel');
const wheelRim = $('wheelRim');
const WHEEL_MAX_DEG = 450;   // haqiqiy ruldagidek ~2.5 marta aylanadi (lock-to-lock) - g'ildirak shunda to'liq buriladi
let wheelDragging = false, wheelRotation = 0, wheelLastAngle = 0;
let keyLeft = false, keyRight = false;   // klaviatura (A/D, ←/→) ham rulni aylantiradi

function wheelAngleFromEvent(ev, rect) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  return Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
}
wheel.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  unlockCarAudio();
  unlockAirportAudio();
  wheelDragging = true;
  try { wheel.setPointerCapture(e.pointerId); } catch { }
  const rect = wheel.getBoundingClientRect();
  wheelLastAngle = wheelAngleFromEvent(e, rect);
});
wheel.addEventListener('pointermove', (e) => {
  if (!wheelDragging) return;
  const rect = wheel.getBoundingClientRect();
  const angle = wheelAngleFromEvent(e, rect);
  // Har harakatda FAQAT oldingi nuqtadan farqni qo'shamiz (boshlang'ich nuqtadan bitta katta farq emas) -
  // shunda 180°dan ko'proq burasang ham yo'nalish hech qachon teskari tomonga "sakramaydi".
  let delta = angle - wheelLastAngle;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  wheelRotation = clamp(wheelRotation + delta, -WHEEL_MAX_DEG, WHEEL_MAX_DEG);
  wheelLastAngle = angle;
});
function releaseWheel() { wheelDragging = false; }
wheel.addEventListener('pointerup', releaseWheel);
wheel.addEventListener('pointercancel', releaseWheel);
wheel.addEventListener('lostpointercapture', releaseWheel);
wheel.addEventListener('contextmenu', (e) => e.preventDefault());

// Har freymda chaqiriladi: klaviatura bilan burish va qo'yib yuborilganda o'zi markazga qaytishi uchun.
function updateWheel(dt) {
  const keySteer = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
  if (!wheelDragging) {
    if (keySteer !== 0) wheelRotation = clamp(wheelRotation + keySteer * WHEEL_MAX_DEG * 3.2 * dt, -WHEEL_MAX_DEG, WHEEL_MAX_DEG);
    else wheelRotation -= wheelRotation * Math.min(1, dt * 8);
  }
  wheelRim.style.transform = `rotate(${wheelRotation}deg)`;
  input.steerAxis = wheelRotation / WHEEL_MAX_DEG;
}

const KEYMAP = {
  ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'hand',
  KeyE: 'up', KeyQ: 'down', KeyH: 'horn',
};
addEventListener('keydown', (e) => {
  unlockCarAudio();
  unlockAirportAudio();
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keyLeft = true; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { keyRight = true; e.preventDefault(); }
  else if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'KeyR') respawn();
  else if (e.code === 'KeyL') toggleLights();
  else if (e.code === 'KeyV') setVehicle(VEHICLE_ORDER[(VEHICLE_ORDER.indexOf(vehicleMode) + 1) % VEHICLE_ORDER.length]);
  else if (e.code === 'Escape') setPaused(!paused);
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = false;
  else if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
});

// ---------- Pauza ----------
let paused = false;
function setPaused(value) {
  paused = value;
  $('pause').hidden = !value;
  if (value) {
    for (const k of Object.keys(input)) input[k] = false;
    input.steerAxis = 0;
    wheelDragging = false;
    wheelRotation = 0;
    wheelRim.style.transform = 'rotate(0deg)';
    updateCarAudio(0, CAR.maxSpeed, false, false);
    updateHorn(false);
    stopAirportAudio();
    silenceRemoteVoices();
  }
  document.querySelectorAll('.ctl.is-down').forEach((el) => el.classList.remove('is-down'));
}
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('vehicleSwitchBtn').addEventListener('click', () => {
  unlockCarAudio();
  unlockAirportAudio();
  setVehicle(VEHICLE_ORDER[(VEHICLE_ORDER.indexOf(vehicleMode) + 1) % VEHICLE_ORDER.length]);
  setPaused(false);
});
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

  for (const tl of trafficLightEntries) updateTrafficLightGroup(tl.group, tl.data, now / 1000);

  if (!paused) {
    updateWheel(dt);
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < steps; i++) stepVehicle(dt / steps);
    resolveVehicleCollisions();

    const speed = Math.hypot(car.vx, car.vz);
    const vf = car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);
    carRoot.position.set(car.x, car.y, car.z);
    carRoot.rotation.y = car.h;

    const acc = (vf - prevVf) / Math.max(dt, 0.001);
    prevVf = vf;
    const ease = Math.min(1, dt * 6);
    const tiltK = currentProfile().tilt;
    tiltPitch += (clamp(-acc * 0.0035, -0.05, 0.05) * tiltK - tiltPitch) * ease;
    tiltRoll += (clamp(-car.steer * clamp(Math.abs(vf) / 20, 0, 1) * 0.05, -0.05, 0.05) * tiltK - tiltRoll) * ease;
    const slopePitch = ramps.length ? -Math.atan(surfaceSlope(Math.sin(car.h), Math.cos(car.h))) : 0;
    tiltSlope += (slopePitch - tiltSlope) * ease;
    carTilt.rotation.set(tiltPitch + tiltSlope, 0, tiltRoll);

    for (const w of carModel.wheels) w.rotation.x += (vf * dt) / 0.38;
    for (const p of carModel.frontPivots) p.rotation.y = -car.steer * 0.5;
    const spinParts = VEHICLE_SPIN[vehicleMode];
    if (spinParts) { const rate = (10 + Math.abs(vf) * 2) * dt; for (const s of spinParts) s.rotation.y += rate; }

    if (carLights && vehicleMode === 'car') {
      carLights.update({
        brake: (input.brake && vf > 0.5) || input.hand,
        reverse: vf < -0.3 || (input.brake && vf <= 0.5),
        button: lightsOn,
      });
    }
    updateVehicleAudio(vf);

    placeCamera(false, dt);
    sun.position.set(car.x + 40, 70, car.z + 25);
    sun.target.position.set(car.x, 0, car.z);

    const kmh = Math.round(speed * 3.6);
    if (kmh !== shownSpeed) { shownSpeed = kmh; speedEl.textContent = kmh; }
    drawMinimap();
    updateBillboards(dt);
    updateBots(dt);
    updateRemotePlayers(dt);
    weather.update(dt);
  }

  renderer.render(scene, camera);

  if (settings.showFps) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`; fpsAcc = 0; fpsFrames = 0; }
  }
}

// ---------- Avariya: onlayn o'yinchilar bir-biriga urilsa ----------
// Har bir telefon FAQAT o'z ulovini tekshiradi (boshqalarning joyi allaqachon bor - qo'shimcha trafik kerak emas).
// Urilganda: itarib chiqaradi, tezlikni kamaytiradi, ovoz chiqaradi va o'z modelining urilgan joyini pachoqlaydi.
// Pachoq ro'yxati Firebase'ga faqat urilgan paytda (kichik matn bilan) yoziladi - keyin kirganlar ham ko'radi.
// Balandlik hisobga olinadi: yuqoridagi samolyot pastdagi mashinaga tegmaydi, yerdagi samolyot esa tegadi.
const crashDents = { car: [], heli: [], plane: [] };   // har bir ulov turining pachoqlari
let localCrashCd = 0;
let localCrashSoundAt = 0;

function localRoot(mode) {
  if (mode === 'car') return carModel && carModel.group ? carModel.group : null;
  return airRoots[mode] || null;
}
function localSkip(mode) {
  if (mode === 'car') return carModel && carModel.wheels ? carModel.wheels : [];
  return (VEHICLE_SPIN[mode] || []).filter(Boolean);
}
function localDims(mode) {
  const root = localRoot(mode);
  if (!root) return null;
  if (!root.userData.crashDims) root.userData.crashDims = measureModel(root);
  return root.userData.crashDims;
}

// Urilish shakli: model o'lchamidan (samolyot/vertolyotda qanot/rotor hisobga olinmasin deb eni cheklanadi).
function bodyFrom(dims, kind) {
  const l = Math.max(dims.l, 1);
  const w = kind === 'heli' ? Math.min(dims.w, l * 0.45) : kind === 'plane' ? Math.min(dims.w, l * 0.7) : dims.w;
  return { hw: Math.max(w, 1.2) / 2, hd: l / 2, minY: dims.minY, maxY: dims.maxY };
}
function obbOf(x, z, h, hw, hd) {
  const c = Math.cos(h), s = Math.sin(h);
  return { x, z, rx: c, rz: -s, fx: s, fz: c, hw, hd };
}
// Ikki burchakli qutining kesishishi (SAT): kirib borish chuqurligi va A->B yo'nalishi.
function obbHit(a, b) {
  const axes = [[a.rx, a.rz], [a.fx, a.fz], [b.rx, b.rz], [b.fx, b.fz]];
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = Infinity, nx = 0, nz = 0, ra = 0;
  for (const [ax, az] of axes) {
    const rA = a.hw * Math.abs(ax * a.rx + az * a.rz) + a.hd * Math.abs(ax * a.fx + az * a.fz);
    const rB = b.hw * Math.abs(ax * b.rx + az * b.rz) + b.hd * Math.abs(ax * b.fx + az * b.fz);
    const d = dx * ax + dz * az;
    const ov = rA + rB - Math.abs(d);
    if (ov <= 0) return null;
    if (ov < best) { best = ov; const sg = d >= 0 ? 1 : -1; nx = ax * sg; nz = az * sg; ra = rA; }
  }
  return { pen: best, nx, nz, ra };
}

function repairAllVehicles() {
  for (const mode of ['car', 'heli', 'plane']) {
    const root = localRoot(mode);
    if (root) repairModel(root);
    crashDents[mode] = [];
  }
}

function crashLocal(hit, mb, dims, lo, hi, closing) {
  const s = clamp(Math.round(closing / 2.2), 1, 10);
  playCrashSound(s, 0, 0);
  localCrashSoundAt = performance.now();
  const list = crashDents[vehicleMode];
  const root = localRoot(vehicleMode);
  if (!root || list.length >= MAX_DENTS) return;
  // Urilgan nuqta: ikkinchi ulov markaziga eng yaqin chekka nuqta (mashinaning o'z koordinatasida)
  const c = Math.cos(car.h), sn = Math.sin(car.h);
  let lx = hit.nx * hit.ra * c - hit.nz * hit.ra * sn;
  let lz = hit.nx * hit.ra * sn + hit.nz * hit.ra * c;
  lx = clamp(lx, -mb.hw, mb.hw);
  lz = clamp(lz, -mb.hd, mb.hd);
  const h = mb.maxY - mb.minY;
  const ly = clamp(((lo + hi) / 2) - car.y, mb.minY + h * 0.2, mb.minY + h * 0.8);
  const r1 = (v) => Math.round(v * 10) / 10;
  const dent = { x: r1(lx), y: r1(ly), z: r1(lz), s };
  list.push(dent);
  applyDent(root, dent, { dims, skip: localSkip(vehicleMode) });
}

function resolveVehicleCollisions() {
  if (!remotePlayers.size) return;
  const dims = localDims(vehicleMode);
  if (!dims) return;
  const mb = bodyFrom(dims, vehicleMode);
  const now = performance.now();
  for (const e of remotePlayers.values()) {
    if (!e.model || !e.dims || !e.group.visible) continue;
    const g = e.group;
    const eb = bodyFrom(e.dims, e.kind);
    const dx = g.position.x - car.x, dz = g.position.z - car.z;
    const reach = Math.hypot(mb.hw, mb.hd) + Math.hypot(eb.hw, eb.hd);
    if (dx * dx + dz * dz > reach * reach) continue;
    // Balandlik bo'yicha kesishmasa (masalan samolyot tepada uchib o'tyapti) - to'qnashmaydi
    const aLo = car.y + mb.minY, aHi = car.y + mb.maxY;
    const bLo = g.position.y + eb.minY, bHi = g.position.y + eb.maxY;
    if (aLo >= bHi - 0.3 || bLo >= aHi - 0.3) continue;   // kamida 30 sm balandlikda kesishsin
    const hit = obbHit(obbOf(car.x, car.z, car.h, mb.hw, mb.hd), obbOf(g.position.x, g.position.z, g.rotation.y, eb.hw, eb.hd));
    if (!hit) continue;

    // Ikkalasi ham yarmidan itariladi (ikkinchi telefon ham o'zini yarim itaradi)
    const push = hit.pen * 0.5 + 0.02;
    car.x -= hit.nx * push;
    car.z -= hit.nz * push;
    const closing = (car.vx - e.vx) * hit.nx + (car.vz - e.vz) * hit.nz;   // yaqinlashish tezligi (m/s)
    if (closing > 0) {
      const j = closing * 0.625;   // biroz qaytish (elastiklik)
      car.vx -= hit.nx * j;
      car.vz -= hit.nz * j;
    }
    if (closing > 2.5 && now > e.crashCd && now > localCrashCd) {
      e.crashCd = now + 400;
      localCrashCd = now + 250;
      crashLocal(hit, mb, dims, Math.max(aLo, bLo), Math.min(aHi, bHi), closing);
    }
  }
}

// Boshqa o'yinchining pachoqlarini uning modeliga qo'llaydi (yangilari qo'shilsa, ovoz ham chiqadi).
function syncRemoteDents(entry, allowSound) {
  if (!entry.model || !entry.dims) return;
  const list = entry.dents;
  if (list.length < entry.dentApplied) {   // ta'mirlangan (boshiga qaytgan)
    repairModel(entry.model);
    entry.dentApplied = 0;
  }
  if (list.length === entry.dentApplied) return;
  const skip = [...entry.wheels, ...entry.spin];
  for (let i = entry.dentApplied; i < list.length; i++) applyDent(entry.model, list[i], { dims: entry.dims, skip });
  entry.dentApplied = list.length;
  const now = performance.now();
  if (allowSound && now - localCrashSoundAt > 700) {   // o'zim urilgan bo'lsam, ovoz allaqachon chiqqan
    const g = entry.group;
    const dx = g.position.x - car.x, dz = g.position.z - car.z;
    const dist = Math.hypot(dx, dz, g.position.y - car.y);
    const rx = -Math.cos(car.h), rz = Math.sin(car.h);
    playCrashSound(list[list.length - 1].s, dist, ((dx * rx + dz * rz) / Math.max(dist, 1)) * 0.75);
  }
}

// ---------- Online: zonadagi boshqa o'yinchilarni ko'rsatish ----------
// Har bir o'yinchi o'z holatini (x,y,z,h,vehicle + qaysi mashina/samolyot/vertolyot ekani + signal) davriy
// ravishda Realtime Database'ga yozadi. Boshqalarning holatini o'qib, ularning HAQIQIY GLB modelini
// (har kim tanlagan mashina, samolyot yoki vertolyot) sahnada ko'rsatamiz. Har bir model internetdan bir
// marta yuklanadi (keyin keshdan), qolganlari uning nusxasi - shuning uchun ko'p o'yinchi bo'lsa ham yengil.
// Uzoqdagi o'yinchi xira ko'rinadi (to'rtburchak emas, o'sha mashinaning o'zi), juda uzoqdagisi chizilmaydi.
// Ovoz (dvigatel/signal) masofaga qarab pasayadi - remoteAudio.js.
const remotePlayers = new Map();   // uid -> { group, model, mats, wheels, spin, kind, key, target, speed, voice, ... }
const remoteLists = { cars: [], air: [] };
const remoteTemplates = new Map();   // "car:Matiz" -> Promise<Object3D> (asl model, nusxalash uchun)
let multiplayerTimer = null;
let multiplayerOffAdd = null, multiplayerOffChange = null, multiplayerOffRemove = null;
let hornLatch = false;   // qisqa bosilgan signal ham keyingi yuborishda ketib qolsin

const REMOTE_NEAR = 70;            // shu masofagacha to'liq ko'rinadi
const REMOTE_FAR = 220;            // shu masofada eng xira (REMOTE_MIN_OPACITY)
const REMOTE_CULL = 420;           // undan uzoqda umuman chizilmaydi (o'yin qotmasligi uchun)
const REMOTE_MIN_OPACITY = 0.28;
const REMOTE_HEAR = REMOTE_HEAR_RANGE;   // ovoz eshitilish masofasi (turiga qarab)
const REMOTE_SHADOW_DIST = 90;     // soya faqat yaqindagi mashinalarga
const REMOTE_RANGE_K = { car: 1, heli: 1.6, plane: 2.4 };   // samolyot/vertolyot katta - uzoqdan ham ko'rinadi
const SPIN_RE = /rotor|propellar|propeller|\bblade\b|\bprop\b/i;

function remoteAvatarFor(kind) {
  const built = kind === 'heli' ? buildHeli() : kind === 'plane' ? buildPlane() : buildCar();
  return built;
}

function resolveRemoteEntry(kind, data) {
  if (kind === 'car') {
    const e = remoteLists.cars.find((c) => c.name === data.car) || remoteLists.cars[0];
    return e ? { ...CAR_DEFAULTS, ...e } : null;
  }
  const want = kind === 'heli' ? 'helicopter' : 'airplane';
  const list = remoteLists.air.filter((a) => a.kind === want);
  const e = list.find((a) => a.name === data.air) || list[0];
  return e ? { ...AIRPORT_DEFAULTS, ...e } : null;
}

// Asl modelni bir marta yuklaydi (g'ildirak va parrak qismlarini belgilab qo'yadi), keyin hamma nusxalaydi.
function loadRemoteTemplate(kind, src) {
  const key = `${kind}:${src.name}`;
  let p = remoteTemplates.get(key);
  if (!p) {
    p = (async () => {
      let root, wheels = [];
      if (kind === 'car') {
        const built = await loadCarModel(src);
        root = built.group;
        wheels = built.wheels || [];
      } else {
        root = await loadAirportModel(src);
      }
      for (const w of wheels) w.userData.rw = true;
      if (kind !== 'car') {
        const mark = (o, inside) => {
          const hit = !inside && SPIN_RE.test(o.name || '');
          if (hit) o.userData.rs = true;
          for (const c of o.children) mark(c, inside || hit);
        };
        mark(root, false);
      }
      delete root.userData.wheels;       // nusxalashda (clone) katta obyektlar JSON'ga aylanib qolmasin
      delete root.userData.frontPivots;
      return root;
    })();
    p.catch(() => remoteTemplates.delete(key));   // xato bo'lsa keyingi safar qayta urinamiz
    remoteTemplates.set(key, p);
  }
  return p;
}

// Har bir o'yinchining materiallari alohida nusxa - shunda uzoqdagisini xira qilish boshqalarga tegmaydi.
function prepareRemoteMaterials(root) {
  const mats = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = list.map((m) => {
      const c = m.clone();
      c.userData.baseOpacity = m.opacity;
      c.userData.baseTransparent = m.transparent;
      c.userData.baseDepthWrite = m.depthWrite;
      mats.push(c);
      return c;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return mats;
}

function clearRemoteModel(entry) {
  if (entry.model) {
    disposeCrash(entry.model);
    entry.group.remove(entry.model);
    for (const m of entry.mats) m.dispose();
  }
  entry.model = null;
  entry.mats = [];
  entry.wheels = [];
  entry.spin = [];
  entry.fade = 1;
  entry.appliedFade = -1;
  entry.shadow = null;
  entry.dims = null;
  entry.dentApplied = 0;
}

function attachRemoteModel(entry, root, wheels, spin) {
  entry.model = root;
  entry.wheels = wheels;
  entry.spin = spin;
  entry.mats = prepareRemoteMaterials(root);
  entry.group.add(root);
  entry.dims = measureModel(root);
  entry.dentApplied = 0;
  syncRemoteDents(entry, false);   // modelga o'sha paytdagi pachoqlarni darhol qo'llaymiz (ovozsiz)
}

async function applyRemoteModel(entry, kind, data) {
  const token = ++entry.token;
  clearRemoteModel(entry);
  const src = resolveRemoteEntry(kind, data);
  let root = null, wheels = [], spin = [];
  if (src) {
    try {
      const template = await loadRemoteTemplate(kind, src);
      if (token !== entry.token || entry.dropped) return;   // eskirgan so'rov yoki o'yinchi chiqib ketgan
      root = template.clone(true);
      root.traverse((o) => {
        if (o.userData.rw) wheels.push(o);
        if (o.userData.rs) spin.push(o);
      });
    } catch (err) {
      console.warn('Boshqa o\u2018yinchi modeli yuklanmadi:', err);
    }
  }
  if (token !== entry.token || entry.dropped) return;
  if (!root) {   // GLB yo'q yoki yuklanmadi - kod bilan yasalgan oddiy model
    const built = remoteAvatarFor(kind);
    root = built.group;
    wheels = built.wheels || [];
    spin = [built.spin, built.spin2].filter(Boolean);
  }
  attachRemoteModel(entry, root, wheels, spin);
}

function dropRemote(uid) {
  const entry = remotePlayers.get(uid);
  if (!entry) return;
  entry.dropped = true;
  if (entry.voice) { entry.voice.dispose(); entry.voice = null; }
  clearRemoteModel(entry);
  scene.remove(entry.group);
  remotePlayers.delete(uid);
}

// Pauza/orqa fonga o'tilganda boshqalarning ovozi ham o'chadi (qaytganda o'zi qayta yoqiladi).
function silenceRemoteVoices() {
  for (const entry of remotePlayers.values()) {
    if (entry.voice) { entry.voice.dispose(); entry.voice = null; }
  }
}

function upsertRemote(uid, data) {
  if (!data || typeof data.x !== 'number' || typeof data.z !== 'number') return;   // hali pozitsiya yubormagan
  const kind = data.vehicle === 'heli' || data.vehicle === 'plane' ? data.vehicle : 'car';
  const key = kind === 'car' ? `car:${data.car || ''}` : `${kind}:${data.air || ''}`;
  const now = performance.now();
  let entry = remotePlayers.get(uid);
  let created = false;
  if (!entry) {
    const group = new THREE.Group();
    group.position.set(data.x, data.y || 0, data.z);
    group.rotation.y = data.h || 0;
    scene.add(group);
    entry = {
      group, kind, key: '', model: null, mats: [], wheels: [], spin: [],
      target: { x: data.x, y: data.y || 0, z: data.z, h: data.h || 0 },
      speed: 0, vx: 0, vz: 0, lastAt: now, horn: false, voice: null,
      fade: 1, appliedFade: -1, shadow: null, token: 0, dropped: false,
      dims: null, dents: [], dentApplied: 0, crashCd: 0,
    };
    created = true;
    remotePlayers.set(uid, entry);
  } else {
    // Tezlikni pozitsiya o'zgarishidan taxminlaymiz (ovoz balandligi/tonini belgilash uchun) - qo'shimcha trafik kerak emas
    const dtU = (now - entry.lastAt) / 1000;
    if (dtU > 0.03) {
      const ivx = (data.x - entry.target.x) / dtU, ivz = (data.z - entry.target.z) / dtU;
      entry.vx += (ivx - entry.vx) * 0.4;
      entry.vz += (ivz - entry.vz) * 0.4;
      entry.speed += (Math.hypot(ivx, ivz) - entry.speed) * 0.4;
      entry.lastAt = now;
    }
  }
  entry.kind = kind;
  entry.target.x = data.x;
  entry.target.y = data.y || 0;
  entry.target.z = data.z;
  entry.target.h = data.h || 0;
  entry.horn = !!data.horn;   // signal holati (faqat o'zgarganda keladi, shuning uchun holat sifatida saqlaymiz)
  entry.dents = decodeDents(data.cr);   // boshqa o'yinchining pachoqlari (yangi kirganlar ham ko'radi)
  if (entry.key !== key) {   // birinchi marta yoki ulov/model almashtirilgan (pachoqlar model yuklangach qo'llanadi)
    entry.key = key;
    applyRemoteModel(entry, kind, data);
  } else {
    syncRemoteDents(entry, !created);
  }
}

function setRemoteFade(entry, op) {
  const q = Math.round(op * 20) / 20;   // 0.05 qadamlarda - har freymda materiallarni qayta yozmaslik uchun
  if (q === entry.appliedFade) return;
  entry.appliedFade = q;
  for (const m of entry.mats) {
    m.opacity = m.userData.baseOpacity * q;
    m.transparent = m.userData.baseTransparent || q < 0.99;
    m.depthWrite = q >= 0.99 ? m.userData.baseDepthWrite : false;
  }
}

function setRemoteShadow(entry, on) {
  if (entry.shadow === on || !entry.model) return;
  entry.shadow = on;
  entry.model.traverse((o) => { if (o.isMesh) o.castShadow = on; });
}

function updateRemotePlayers(dt) {
  const k = Math.min(1, dt * 8);
  const now = performance.now();
  const rx = -Math.cos(car.h), rz = Math.sin(car.h);   // bizning "o'ng" tomonimiz (ovozni chap/o'ngga taqsimlash uchun)
  for (const entry of remotePlayers.values()) {
    const g = entry.group;
    g.position.x += (entry.target.x - g.position.x) * k;
    g.position.y += (entry.target.y - g.position.y) * k;
    g.position.z += (entry.target.z - g.position.z) * k;
    let dh = entry.target.h - g.rotation.y;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    g.rotation.y += dh * k;
    if (now - entry.lastAt > 600) { const dec = Math.exp(-dt * 3); entry.speed *= dec; entry.vx *= dec; entry.vz *= dec; }   // yangilanish kelmasa, to'xtab qolgan deb hisoblaymiz

    const dx = g.position.x - car.x, dy = g.position.y - car.y, dz = g.position.z - car.z;
    const dist = Math.hypot(dx, dy, dz);
    const rk = REMOTE_RANGE_K[entry.kind] || 1;

    // ---- Ko'rinish: yaqinda aniq, uzoqda xira, juda uzoqda chizilmaydi ----
    const visible = !!entry.model && dist < REMOTE_CULL * rk;
    g.visible = visible;
    if (visible) {
      const near = REMOTE_NEAR * rk, far = REMOTE_FAR * rk;
      const t = dist <= near ? 0 : dist >= far ? 1 : (dist - near) / (far - near);
      setRemoteFade(entry, 1 - (1 - REMOTE_MIN_OPACITY) * t);
      setRemoteShadow(entry, shadowsOn && dist < REMOTE_SHADOW_DIST * rk);
      const rate = entry.speed * dt / 0.38;
      for (const w of entry.wheels) w.rotation.x += rate;
      const spinRate = (10 + entry.speed * 2) * dt;
      for (const s of entry.spin) s.rotation.y += spinRate;
    }

    // ---- Ovoz: faqat eshitilish masofasida; uzoqlashgani sari pasayadi ----
    const hearRange = REMOTE_HEAR[entry.kind] || 120;
    if (!paused && dist < hearRange) {
      if (!entry.voice) entry.voice = createRemoteVoice(entry.kind);
      if (entry.voice) {
        entry.voice.update({
          dist,
          pan: ((dx * rx + dz * rz) / Math.max(dist, 1)) * 0.75,
          speed: entry.speed,
          horn: entry.horn,
        });
      }
    } else if (entry.voice) {
      entry.voice.dispose();
      entry.voice = null;
    }
  }
}

// player-game.js zonaga qo'shilgach shuni chaqiradi: o'z holatimizni yuborishni boshlaymiz
// va zonadagi boshqalarni kuzatib, ularni sahnaga qo'shamiz. Firebase shu yerda, birinchi marta
// chaqirilgandagina yuklanadi — offline o'yin (game.html) buni hech qachon chaqirmaydi.
export async function startMultiplayer(zoneId, uid) {
  const [{ db }, { ref: dbRef, onChildAdded, onChildChanged, onChildRemoved, update: dbUpdate }, cars, air] = await Promise.all([
    import('./firebase.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js'),
    fetchCarList().catch(() => []),
    fetchAirportList().catch(() => []),
  ]);
  remoteLists.cars = cars;
  remoteLists.air = air;
  initRemoteAudio();

  const playersRef = dbRef(db, `zones/${zoneId}/players`);

  multiplayerOffAdd = onChildAdded(playersRef, (snap) => {
    if (snap.key !== uid) upsertRemote(snap.key, snap.val());
  });
  multiplayerOffChange = onChildChanged(playersRef, (snap) => {
    if (snap.key !== uid) upsertRemote(snap.key, snap.val());
  });
  multiplayerOffRemove = onChildRemoved(playersRef, (snap) => dropRemote(snap.key));

  const myRef = dbRef(db, `zones/${zoneId}/players/${uid}`);
  const lastSent = {};   // oxirgi muvaffaqiyatli yuborilgan qiymatlar - faqat o'zgarganini yuboramiz (Firebase limiti tejaladi)
  let lastFullAt = performance.now();
  multiplayerTimer = setInterval(() => {
    if (paused) {
      if (lastSent.horn) dbUpdate(myRef, { horn: false }).then(() => { lastSent.horn = false; }).catch(() => {});
      return;
    }
    if (performance.now() - lastFullAt > 10000) {   // har 10 soniyada to'liq yozuvni qayta yuboramiz (aloqa uzilib yozuv o'chib ketgan bo'lsa, tiklanadi)
      for (const k of Object.keys(lastSent)) delete lastSent[k];
      lastFullAt = performance.now();
    }
    const horn = vehicleMode === 'car' && (input.horn || hornLatch);
    hornLatch = false;
    const next = {
      x: Math.round(car.x * 10) / 10,
      y: Math.round(car.y * 10) / 10,
      z: Math.round(car.z * 10) / 10,
      h: Math.round(car.h * 100) / 100,
      vehicle: vehicleMode,
      car: carProfile.name || null,                                  // qaysi mashina - boshqalar shuni GLB qilib ko'radi
      air: vehicleMode === 'car' ? null : (airportProfiles[vehicleMode].name || null),   // qaysi samolyot/vertolyot
      horn,
      cr: encodeDents(crashDents[vehicleMode]),                      // pachoqlar (faqat urilganda o'zgaradi)
    };
    const changed = {};
    let any = false;
    for (const k of Object.keys(next)) {
      if (lastSent[k] !== next[k]) { changed[k] = next[k]; any = true; }
    }
    if (!any) return;   // joyida turgan o'yinchi hech narsa yubormaydi
    dbUpdate(myRef, changed).then(() => Object.assign(lastSent, changed)).catch(() => {});   // internet uzilsa, keyingi urinishda qayta yuboriladi
  }, 150);
}

export function stopMultiplayer() {
  if (multiplayerTimer) clearInterval(multiplayerTimer);
  multiplayerTimer = null;
  if (multiplayerOffAdd) multiplayerOffAdd();
  if (multiplayerOffChange) multiplayerOffChange();
  if (multiplayerOffRemove) multiplayerOffRemove();
  for (const uid of [...remotePlayers.keys()]) dropRemote(uid);
}

// ---------- Ishga tushirish ----------
async function start() {
  const loadingText = $('loadingText'), bar = $('loadingBar');
  await setupCar(
    (text) => { loadingText.textContent = text; },
    (p) => { bar.style.width = `${Math.round(8 + p * 92)}%`; },
  );
  await setupAirport(
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