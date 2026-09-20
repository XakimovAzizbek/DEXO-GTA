// DEXO GTA: ob-havo (yomg'ir, qor, shamol). Sozlamalar ob-havo.txt dan keladi (data.js: fetchWeather).
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
      void main() { gl_FragColor = vec4(0.72, 0.82, 0.94, 0.5 * vA); }`,
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
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - smoothstep(0.1, 0.5, d)) * 0.9);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// config = { rain, snow, wind } (true/false). Qaytaradi: { enabled, wind:{x,z}, patch(mat, opts), update(dt) }
export function createWeather({ scene, camera, renderer, quality, config, hemi, sun }) {
  const rainOn = !!config.rain, snowOn = !!config.snow, windOn = !!config.wind;
  const wind = { x: 0, z: 0 };
  if (!(rainOn || snowOn || windOn)) return { enabled: false, wind, patch() {}, update() {} };

  const density = { low: 0.35, medium: 0.7, high: 1 }[quality] ?? 0.7;
  const box = new THREE.Vector3(70, 30, 70);

  // Osmon va yorug'lik kayfiyati: yomg'ir bulutli va qorong'i, qor och kulrang
  const mood = rainOn
    ? { sky: '#7f8c99', near: 35, far: 210, hemi: 0.85, sun: 0.55 }
    : snowOn ? { sky: '#c5d0da', near: 45, far: 230, hemi: 1.0, sun: 0.9 } : null;
  if (mood) {
    scene.background.set(mood.sky);
    scene.fog.color.set(mood.sky);
    scene.fog.near = mood.near;
    scene.fog.far = mood.far;
    hemi.intensity = mood.hemi;
    sun.intensity = mood.sun;
  }

  if (snowOn) U.uSnow.value = 0.35;      // qor boshida ozgina, keyin asta-sekin qalinlashadi
  if (rainOn) U.uWet.value = 0.6;

  const rainU = {
    uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uOffset: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 1.1 },
  };
  const snowU = {
    uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uOffset: { value: new THREE.Vector3() },
    uTime: U.uTime, uSize: { value: 0.06 }, uScale: { value: 1000 },
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

  return { enabled: true, wind, patch: patchMaterial, update };
}
