// DEXO GTA: ob-havo (yomg'ir, qor, shamol, kun, tun, tutilish). Sozlamalar ob-havo.txt dan keladi (data.js: fetchWeather).
// Hammasi o'chiq bo'lsa hech narsa yuklanmaydi va hech qaysi material o'zgarmaydi.
import * as THREE from 'three';

const WIND_ACC = 6;                     // shamolning mashinaga ta'siri (m/s^2), faqat harakatda seziladi
const WIND_DIR = { x: 0.8, z: 0.6 };    // shamol yo'nalishi (g'arbdan sharqqa, biroz janubga)

// Hamma materiallar uchun umumiy uniformlar
const U = {
  uTime: { value: 0 },    // daraxt tebranishi uchun vaqt
  uSnow: { value: 0 },    // qor qalinligi 0..1
  uWet: { value: 0 },     // ho'llik 0..1 (yomg'ir)
  uWind: { value: 0 },    // shamol kuchi (tebranish amplitudasi)
};

// Materialga qor (tepaga qaragan yuzalar oqaradi), ho'llik va shamoldan tebranish qo'shadi.
// Material: MeshLambertMaterial (uylar, daraxtlar, yo'llar, yer).
function patchMaterial(mat, { snowMax = 1, sway = false } = {}) {
  if (mat.userData.weatherPatched) return;
  mat.userData.weatherPatched = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uSnow = U.uSnow;
    shader.uniforms.uWet = U.uWet;
    shader.uniforms.uWind = U.uWind;
    shader.uniforms.uSnowMax = { value: snowMax };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  vec3 wxN = objectNormal;
  #ifdef USE_INSTANCING
    wxN = mat3(instanceMatrix) * wxN;
  #endif
  wxN = mat3(modelMatrix) * wxN;
  vUp = normalize(wxN).y;
}`);
    if (sway) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    float wxPhase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
  #else
    float wxPhase = 0.0;
  #endif
  float wxH = clamp(position.y / 8.0, 0.0, 1.0);
  float wxAmt = uWind * wxH * wxH * 0.45;
  transformed.x += sin(uTime * 1.9 + wxPhase) * wxAmt;
  transformed.z += cos(uTime * 1.4 + wxPhase * 1.3) * wxAmt * 0.6;
}`);
    }

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;\nuniform float uSnow;\nuniform float uWet;\nuniform float uSnowMax;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(1.0, 0.72, uWet);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), smoothstep(0.4, 0.8, vUp) * uSnow * uSnowMax);`);
  };
  mat.customProgramCacheKey = () => (sway ? 'dexo-weather-sway' : 'dexo-weather');
  mat.needsUpdate = true;
}

// Yomg'ir tomchilari: kameraga nisbatan aylanib turadigan qutida, GPU da harakatlanadi.
function makeRain(count, uniforms) {
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), s = Math.random();
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
      seed[j] = s;
      end[j] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float aSeed;
      attribute float aEnd;
      uniform vec3 uCam, uBox, uOffset, uVel;
      uniform float uLen;
      varying float vA;
      void main() {
        vec3 p = position * uBox + uOffset * (0.85 + 0.3 * aSeed);
        vec3 c = vec3(uCam.x, uBox.y * 0.5 - 2.0, uCam.z);
        p = c + mod(p - c + 0.5 * uBox, uBox) - 0.5 * uBox;
        p -= normalize(uVel) * uLen * aEnd;
        vA = 1.0 - aEnd * 0.85;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying float vA;
      uniform float uBright;
      void main() { gl_FragColor = vec4(vec3(0.72, 0.82, 0.94) * uBright, 0.5 * vA); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

// Qor parchalari: yumshoq dumaloq nuqtalar, sekin tushadi va chayqaladi.
function makeSnow(count, uniforms) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random();
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float aSeed;
      uniform vec3 uCam, uBox, uOffset;
      uniform float uTime, uSize, uScale;
      void main() {
        vec3 p = position * uBox + uOffset * (0.8 + 0.4 * aSeed);
        p.x += sin(uTime * 0.9 + aSeed * 6.283) * 0.8;
        p.z += cos(uTime * 0.7 + aSeed * 9.0) * 0.8;
        vec3 c = vec3(uCam.x, uBox.y * 0.5 - 2.0, uCam.z);
        p = c + mod(p - c + 0.5 * uBox, uBox) - 0.5 * uBox;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uSize * uScale / max(0.1, -mv.z), 1.5, 14.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uBright;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(uBright), (1.0 - smoothstep(0.1, 0.5, d)) * 0.9);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// ---------- Kun va tun: osmon, quyosh, oy, yulduzlar, tutilish ----------
// tun: on -> tun. kun: on va tun: on birga -> quyosh va oy tutilishi (g'alati ob-havo).
// Osmon jismlari kamera bilan birga suriladi (cheksiz uzoqda), dunyo geometriyasi ularni to'sadi.
const SUN_DIR = new THREE.Vector3(0.77, 0.34, 0.54).normalize();      // quyosh yo'nalishi (past, shunda kadrga kiradi)
const MOON_DIR = new THREE.Vector3(-0.72, 0.47, -0.51).normalize();   // tundagi oy
const SKY_DIST = 450;
const SUN_SIZE = 150;
const ECLIPSE_CYCLE = 120;    // soniya: oy quyosh oldidan o'tib turadi

function canvasTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function sunTexture() {
  return canvasTexture((g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,250,215,1)');
    grad.addColorStop(0.235, 'rgba(255,236,160,1)');
    grad.addColorStop(0.26, 'rgba(255,200,90,0.55)');
    grad.addColorStop(0.5, 'rgba(255,170,60,0.14)');
    grad.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}
function moonTexture() {
  return canvasTexture((g, s) => {
    const h = s / 2;
    const halo = g.createRadialGradient(h, h, h * 0.35, h, h, h);
    halo.addColorStop(0, 'rgba(190,205,255,0.35)');
    halo.addColorStop(1, 'rgba(190,205,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#e9edf7';
    g.beginPath(); g.arc(h, h, h * 0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,160,190,0.45)';         // oy "dengizlari"
    for (const [x, y, r] of [[-0.14, -0.1, 0.11], [0.1, 0.06, 0.14], [-0.05, 0.16, 0.07], [0.17, -0.15, 0.06]]) {
      g.beginPath(); g.arc(h + x * s, h + y * s, r * h, 0, Math.PI * 2); g.fill();
    }
  });
}
function darkMoonTexture() {      // tutilishdagi qora oy: quyosh diskidan biroz kattaroq
  return canvasTexture((g, s) => {
    const h = s / 2;
    g.fillStyle = '#07070d';
    g.beginPath(); g.arc(h, h, h * 0.245, 0, Math.PI * 2); g.fill();
  });
}
function coronaTexture() {
  return canvasTexture((g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0)');
    grad.addColorStop(0.24, 'rgba(255,250,235,0.95)');
    grad.addColorStop(0.32, 'rgba(230,220,255,0.5)');
    grad.addColorStop(0.55, 'rgba(180,170,255,0.12)');
    grad.addColorStop(1, 'rgba(180,170,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}
function makeSprite(tex, size, additive, order) {
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = order;
  return sprite;
}
function makeStars(count) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.05 + Math.random() * 0.95;              // faqat ufqdan yuqorida
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 500; pos[i * 3 + 1] = y * 500; pos[i * 3 + 2] = Math.sin(a) * r * 500;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  return new THREE.Points(geo, mat);
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// config = { rain, snow, wind, day, night } (true/false).
// Qaytaradi: { enabled, mode: 'day'|'night'|'eclipse', night, wind:{x,z}, patch(mat, opts), update(dt) }
export function createWeather({ scene, camera, renderer, quality, config, hemi, sun }) {
  const rainOn = !!config.rain, snowOn = !!config.snow, windOn = !!config.wind;
  const mode = config.night && config.day ? 'eclipse' : config.night ? 'night' : 'day';
  const precip = rainOn || snowOn;
  const wind = { x: 0, z: 0 };
  if (!(precip || windOn || mode !== 'day')) return { enabled: false, mode: 'day', night: false, wind, patch() {}, update() {} };

  const density = { low: 0.35, medium: 0.7, high: 1 }[quality] ?? 0.7;
  const box = new THREE.Vector3(70, 30, 70);

  // Osmon va yorug'lik: kun/tun/tutilish + yomg'ir/qor ta'siri
  const C = THREE.Color;
  const P = {
    day: { sky: new C('#a9d0ea'), hemiC: new C(0xe6f1ff), hemiG: new C(0x6f7a55), sunC: new C(0xfff1d6), hemiI: 1.05, sunI: 1.5, near: 90, far: 340 },
    night: { sky: new C('#070b18'), hemiC: new C('#6f86d6'), hemiG: new C('#1d2338'), sunC: new C('#93a9ff'), hemiI: 0.34, sunI: 0.28, near: 45, far: 240 },
    ecl: { sky: new C('#231433'), hemiC: new C('#b598e0'), hemiG: new C('#2a1c33'), sunC: new C('#ff9a55') },
  };
  const cur = { sky: new C(), hemiC: new C(), hemiG: new C(), sunC: new C() };
  const gray = new C();
  let bright = 1;                            // yomg'ir/qor zarralarining yorqinligi (tunda kamayadi)

  function applyMood(cov) {
    const dark = mode === 'night' ? 1 : mode === 'eclipse' ? Math.pow(cov, 0.8) * 0.88 : 0;
    cur.sky.copy(P.day.sky).lerp(P.night.sky, dark);
    cur.hemiC.copy(P.day.hemiC).lerp(P.night.hemiC, dark);
    cur.hemiG.copy(P.day.hemiG).lerp(P.night.hemiG, dark);
    cur.sunC.copy(P.day.sunC).lerp(P.night.sunC, dark);
    let hemiI = mix(P.day.hemiI, P.night.hemiI, dark), sunI = mix(P.day.sunI, P.night.sunI, dark);
    let near = mix(P.day.near, P.night.near, dark), far = mix(P.day.far, P.night.far, dark);
    if (mode === 'eclipse') {                // tutilishda osmon binafsha-to'q sariq tusga kiradi
      const e = cov * 0.75;
      cur.sky.lerp(P.ecl.sky, e); cur.hemiC.lerp(P.ecl.hemiC, e); cur.hemiG.lerp(P.ecl.hemiG, e); cur.sunC.lerp(P.ecl.sunC, e);
    }
    if (precip) {
      if (mode === 'day') {                  // kunduzi: avvalgi yomg'ir/qor kayfiyati
        const m = rainOn
          ? { sky: '#7f8c99', near: 35, far: 210, hemi: 0.85, sun: 0.55 }
          : { sky: '#c5d0da', near: 45, far: 230, hemi: 1.0, sun: 0.9 };
        cur.sky.set(m.sky); near = m.near; far = m.far; hemiI = m.hemi; sunI = m.sun;
      } else {                               // tunda/tutilishda: mavjud rangni kulrangga yaqinlashtirib, yorug'likni kamaytiramiz
        const k = rainOn ? { hemi: 0.81, sun: 0.37, near: 0.39, far: 0.62, gray: 0.7 } : { hemi: 0.95, sun: 0.6, near: 0.5, far: 0.68, gray: 0.4 };
        const l = 0.3 * cur.sky.r + 0.59 * cur.sky.g + 0.11 * cur.sky.b;
        gray.setRGB(l, l, l);
        cur.sky.lerp(gray, k.gray);
        hemiI *= k.hemi; sunI *= k.sun; near *= k.near; far *= k.far;
      }
    }
    scene.background.copy(cur.sky);
    scene.fog.color.copy(cur.sky);
    scene.fog.near = near; scene.fog.far = far;
    hemi.color.copy(cur.hemiC); hemi.groundColor.copy(cur.hemiG); hemi.intensity = hemiI;
    sun.color.copy(cur.sunC); sun.intensity = sunI;
    bright = 1 - 0.55 * dark;
    return dark;
  }
  let dark = 0;
  if (precip || mode !== 'day') dark = applyMood(0);

  // Osmon jismlari
  const skyGroup = new THREE.Group();
  skyGroup.visible = mode !== 'day';
  scene.add(skyGroup);
  let stars = null, moon = null, corona = null, sunSprite = null, darkMoon = null;
  const sunPos = SUN_DIR.clone().multiplyScalar(SKY_DIST);
  const T1 = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 1, 0)).normalize();
  const T2 = new THREE.Vector3().crossVectors(T1, SUN_DIR).normalize();
  const discR = 0.235 * SUN_SIZE / 2;        // quyosh diski radiusi (dunyo birligida)
  if (mode === 'night') {
    moon = makeSprite(moonTexture(), 70, false, 1);
    moon.position.copy(MOON_DIR).multiplyScalar(SKY_DIST);
    stars = makeStars(Math.round(800 * (0.5 + 0.5 * density)));
    skyGroup.add(moon, stars);
  } else if (mode === 'eclipse') {
    sunSprite = makeSprite(sunTexture(), SUN_SIZE, true, 1);
    corona = makeSprite(coronaTexture(), SUN_SIZE * 1.9, true, 2);
    darkMoon = makeSprite(darkMoonTexture(), SUN_SIZE, false, 3);
    sunSprite.position.copy(sunPos);
    corona.position.copy(sunPos).multiplyScalar(0.998);
    darkMoon.position.copy(sunPos).multiplyScalar(0.996);
    corona.material.opacity = 0;
    stars = makeStars(Math.round(600 * (0.5 + 0.5 * density)));
    skyGroup.add(sunSprite, corona, darkMoon, stars);
  }

  if (snowOn) U.uSnow.value = 0.35;      // qor boshida ozgina, keyin asta-sekin qalinlashadi
  if (rainOn) U.uWet.value = 0.6;

  const rainU = {
    uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uOffset: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 1.1 }, uBright: { value: bright },
  };
  const snowU = {
    uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uOffset: { value: new THREE.Vector3() },
    uTime: U.uTime, uSize: { value: 0.06 }, uScale: { value: 1000 }, uBright: { value: bright },
  };
  const rain = rainOn ? makeRain(Math.round(3000 * density), rainU) : null;
  const snow = snowOn ? makeSnow(Math.round(3000 * density), snowU) : null;
  if (rain) scene.add(rain);
  if (snow) scene.add(snow);

  const rainVel = new THREE.Vector3(), snowVel = new THREE.Vector3();
  let t = 0;

  function update(dt) {
    t += dt;
    U.uTime.value = t;
    const gust = windOn
      ? Math.max(0.2, Math.min(1.2, 0.7 + 0.3 * Math.sin(t * 0.5) + 0.15 * Math.sin(t * 1.7 + 1)))
      : 0;
    U.uWind.value = gust;
    wind.x = WIND_DIR.x * gust * WIND_ACC;
    wind.z = WIND_DIR.z * gust * WIND_ACC;

    if (snowOn) U.uSnow.value = Math.min(1, U.uSnow.value + dt * 0.011);   // ~1 daqiqada to'la
    if (rainOn) U.uWet.value = Math.min(1, U.uWet.value + dt * 0.03);

    const cam = camera.position;

    if (mode !== 'day') {
      skyGroup.position.copy(cam);
      if (mode === 'night') {
        stars.material.opacity = 0.75 + 0.25 * Math.sin(t * 1.3);
      } else {
        // Oy quyosh oldidan o'tadi: markazlari orasidagi masofaga qarab qoplanish (0..1)
        const ph = (t * Math.PI * 2) / ECLIPSE_CYCLE - Math.PI / 2;       // boshida oy uzoqda, ~30 soniyada to'liq tutilish
        const dx = 2.6 * Math.sin(ph), dy = 0.35 * Math.sin(ph * 0.5 + 1);
        darkMoon.position.copy(sunPos).multiplyScalar(0.996)
          .addScaledVector(T1, dx * discR).addScaledVector(T2, dy * discR);
        const cov = 1 - smooth(0.05, 2.0, Math.hypot(dx, dy));
        dark = applyMood(cov);
        corona.material.opacity = smooth(0.55, 1, cov);
        stars.material.opacity = smooth(0.35, 0.9, dark) * 0.9;
      }
    }
    rainU.uBright.value = snowU.uBright.value = bright;

    if (rain) {
      rainVel.set(WIND_DIR.x * gust * 6, -24, WIND_DIR.z * gust * 6);
      rainU.uOffset.value.addScaledVector(rainVel, dt);
      rainU.uVel.value.copy(rainVel);
      rainU.uCam.value.copy(cam);
    }
    if (snow) {
      snowVel.set(WIND_DIR.x * gust * 3.5, -1.6, WIND_DIR.z * gust * 3.5);
      snowU.uOffset.value.addScaledVector(snowVel, dt);
      snowU.uCam.value.copy(cam);
      snowU.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
  }

  return {
    enabled: true, mode, night: mode !== 'day', wind, update,
    patch: (precip || windOn) ? patchMaterial : () => {},       // faqat kun/tun bo'lsa materiallar o'zgarmaydi
  };
}
