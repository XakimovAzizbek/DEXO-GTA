// DEXO GTA: raketa tizimi - uchish, portlash, kuyindi (2 daqiqa) va tutun.
// Bu fayl faqat KO'RINISH va uchish bilan shug'ullanadi. Nimaga urilganini (yer, bino, mashina, samolyot)
// va zararni game.js hal qiladi: collide(...) va onExplode(...) shu yerdan chaqiriladi.
import * as THREE from 'three';
import { buildRocketModel } from './models.js';

export const SCORCH_LIFE = 120;      // kuyindi necha soniya turadi (2 daqiqa)
const SCORCH_FADE = 12;              // oxirgi soniyalarda asta yo'qoladi
const MAX_SCORCH = 48;
const POOL_SIZE = 340;               // bir vaqtda ko'rinadigan tutun/olov/parcha zarralari
const ROCKET_LIFE = 7;               // soniya: hech narsaga tegmasa, havoda portlaydi
const ROCKET_BOOST = 140;            // m/s: samolyot tezligiga qo'shiladi
const BLAST_DEFAULT = 16;            // m: oddiy portlash radiusi (muharrirda rocketblast)
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createRocketSystem({ scene, camera, groundAt, inBounds, collide, onExplode }) {
  let clock = 0;
  let shake = 0;
  let shakeDecay = 3;    // kuchli portlashda yer uzoqroq titraydi
  const rockets = [];
  const blasts = [];     // portlash shari / halqasi
  const scorches = [];   // yerdagi kuyindi va devordagi qurum
  const live = [];       // faol zarralar

  // ---------- Zarralar (oldindan yaratilgan hovuz - o'yin qotmasligi uchun) ----------
  const sphereGeo = new THREE.SphereGeometry(1, 7, 6);
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    pool.push(m);
  }
  function puff(x, y, z, vx, vy, vz, life, s0, s1, op, col0, col1, grav = 0, drag = 0.5) {
    const m = pool.pop();
    if (!m) return;
    m.visible = true;
    m.position.set(x, y, z);
    m.scale.setScalar(s0);
    live.push({ m, vx, vy, vz, life, age: 0, s0, s1, op, c0: new THREE.Color(col0), c1: new THREE.Color(col1), grav, drag });
  }
  function updateParticles(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.m.visible = false;
        pool.push(p.m);
        live[i] = live[live.length - 1];
        live.pop();
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(t));
      const mat = p.m.material;
      mat.color.copy(p.c0).lerp(p.c1, Math.min(1, t * 1.6));
      mat.opacity = p.op * Math.pow(1 - t, 1.3);
    }
  }

  // ---------- Kuyindi (yerdagi qora dog') ----------
  const scorchTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(6,5,4,0.96)');
    grad.addColorStop(0.4, 'rgba(8,6,5,0.9)');
    grad.addColorStop(0.7, 'rgba(14,11,9,0.55)');
    grad.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {           // portlash nurlari - chetlari notekis bo'lsin
      const a = Math.random() * Math.PI * 2, len = 38 + Math.random() * 24;
      g.strokeStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.3})`;
      g.lineWidth = 3 + Math.random() * 7;
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
      g.stroke();
    }
    return new THREE.CanvasTexture(c);
  })();
  const discGeo = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);

  function addScorch(x, z, r) {
    if (scorches.length >= MAX_SCORCH) removeScorch(0);
    const mat = new THREE.MeshBasicMaterial({
      map: scorchTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(discGeo, mat);
    mesh.position.set(x, groundAt(x, z) + 0.08, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(r);
    mesh.renderOrder = 2;
    scene.add(mesh);
    scorches.push({ mesh, mat, born: clock, base: 1, smokeAt: clock, smoke: true });
  }
  function addBlob(x, y, z, r) {              // devor/bino yuzidagi qurum
    if (scorches.length >= MAX_SCORCH) removeScorch(0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.6, depthWrite: false });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(r, r * 0.9, r);
    scene.add(mesh);
    scorches.push({ mesh, mat, born: clock, base: 0.6, smokeAt: clock, smoke: false });
  }
  function removeScorch(i) {
    const s = scorches[i];
    scene.remove(s.mesh);
    s.mat.dispose();
    scorches.splice(i, 1);
  }
  function updateScorches() {
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i];
      const age = clock - s.born;
      if (age >= SCORCH_LIFE) { removeScorch(i); continue; }
      s.mat.opacity = s.base * Math.min(1, (SCORCH_LIFE - age) / SCORCH_FADE);
      if (s.smoke && age < 30 && clock >= s.smokeAt) {     // dastlabki 30 soniya tutab turadi
        s.smokeAt = clock + 0.4 + Math.random() * 0.4;
        const p = s.mesh.position;
        if (p.distanceToSquared(camera.position) < 200 * 200) {
          puff(p.x + (Math.random() - 0.5) * 4, p.y + 0.5, p.z + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2,
            3.5, 1.2, 4.5, 0.4, 0x4a4540, 0x1c1a18, 0, 0.2);
        }
      }
    }
  }

  // ---------- Portlash ----------
  const flash = new THREE.PointLight(0xffa24a, 0, 140, 2);   // doim sahnada (o'chirib-yoqilsa, hamma material qayta kompilyatsiya bo'ladi)
  scene.add(flash);
  let flashT = 0;
  const ringGeo = new THREE.RingGeometry(0.82, 1, 44).rotateX(-Math.PI / 2);

  // opts: { blast (portlash radiusi, m), power (kuch ko'paytirgichi) } - bermasa oddiy portlash
  function explode(x, y, z, kind, opts = {}) {
    const k = _clamp((opts.blast || BLAST_DEFAULT) / BLAST_DEFAULT, 0.35, 4);   // kattalik
    const pw = _clamp(opts.power || 1, 0.3, 4);                                 // kuch
    const ks = Math.sqrt(k);
    const g = groundAt(x, z);
    const alt = y - g;
    const cy = Math.max(y, g + 1.5);

    // Olov shari + oq-sariq yadro
    const mk = (color, r, life) => {
      const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
      mesh.position.set(x, cy, z);
      scene.add(mesh);
      blasts.push({ mesh, age: 0, life, r, ring: false });
    };
    mk(0xff9a2e, 8.5 * k, 0.75 * (0.8 + 0.2 * k));
    mk(0xfff0b0, 4.8 * k, 0.45 * (0.8 + 0.2 * k));
    if (alt < 14 * k) {                   // yer ustidagi zarba to'lqini
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(x, g + 0.15, z);
      scene.add(ring);
      blasts.push({ mesh: ring, age: 0, life: 0.7 * (0.8 + 0.2 * k), r: 26 * k, ring: true });
    }

    const cnt = Math.min(2, k);           // zarralar soni (hovuz tugab qolmasin)
    // Olov zarralari
    for (let i = 0, n = Math.round(42 * cnt); i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() * 1.2 - 0.2), sp = (6 + Math.random() * 20) * k;
      puff(x, cy, z, Math.cos(a) * sp, e * sp * 0.8 + 3, Math.sin(a) * sp,
        0.5 + Math.random() * 0.7, (1 + Math.random()) * k, (3 + Math.random() * 2.5) * k, 0.95, 0xffe08a, 0xff4a10, -3, 1.4);
    }
    // Parchalar (qora, og'ir - pastga tushadi)
    for (let i = 0, n = Math.round(22 * cnt); i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (12 + Math.random() * 28) * ks;
      puff(x, cy, z, Math.cos(a) * sp, (10 + Math.random() * 22) * ks, Math.sin(a) * sp,
        1.2 + Math.random() * 1.2, (0.25 + Math.random() * 0.3) * ks, 0.2 * ks, 1, 0x2a2623, 0x0d0c0b, 26, 0.3);
    }
    // Qora tutun ustuni
    for (let i = 0, n = Math.round(20 * cnt); i < n; i++) {
      puff(x + (Math.random() - 0.5) * 5 * k, cy + Math.random() * 2, z + (Math.random() - 0.5) * 5 * k,
        (Math.random() - 0.5) * 3, (3 + Math.random() * 6) * ks, (Math.random() - 0.5) * 3,
        5 + Math.random() * 3.5, 2.4 * k, (10 + Math.random() * 3) * k, 0.6, 0x5d5853, 0x1b1a19, 0, 0.35);
    }
    if (alt < 6 * k) {                     // chang-tuproq halqasi
      for (let i = 0, n = Math.round(16 * cnt); i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, sp = (10 + Math.random() * 9) * k;
        puff(x, g + 0.8, z, Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp,
          1.3, 1.5 * k, 5 * k, 0.65, 0x9b8462, 0x5e5240, 0, 1.6);
      }
    }

    // Yorug'lik chaqnashi
    flash.position.set(x, Math.max(y, g + 4), z);
    flash.distance = 140 * Math.max(1, k);
    flashT = 0.5;

    // Yer titrashi (kamera silkinishi): kuch va radius qancha katta bo'lsa, shuncha kuchli va uzoq, shuncha uzoqqa yetadi
    const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
    const reach = 110 * k;
    const cap = Math.min(7, 2.4 * pw * ks);
    shake = Math.max(shake, Math.min(cap, 2.6 * pw * ks * (1 - d / reach)));
    shakeDecay = 3 / Math.max(1, ks * Math.sqrt(pw));

    // Kuyindi: yerga tegsa katta dog'; devorga tegsa - qurum + pastida dog'
    if (kind === 'wall' && alt > 1.8) {
      addBlob(x, y, z, 3.4 * k);
      if (alt < 30) addScorch(x, z, 5.5 * k);
    } else if (alt < 4 * Math.max(1, k)) {
      addScorch(x, z, (kind === 'ground' ? 9 : 7) * k);
    }
  }

  function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        scene.remove(b.mesh);
        b.mesh.material.dispose();
        blasts.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);                // tez ochilib, sekinlashadi
      b.mesh.scale.setScalar(Math.max(0.01, b.r * (b.ring ? e : 0.35 + 0.65 * e)));
      b.mesh.material.opacity = (b.ring ? 0.85 : 0.95) * (1 - t * t);
    }
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      flash.intensity = 900 * Math.pow(flashT / 0.5, 2);
    } else if (flash.intensity !== 0) flash.intensity = 0;
  }

  // ---------- Raketa uchishi ----------
  // spec: { x, y, z, h (yo'nalish), v0 (samolyot tezligi), pitch (pastga og'ish, radian), size, mine, owner }
  function fire(spec) {
    const mesh = buildRocketModel(spec.size || 2.4, { flame: true });
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(spec.pitch || 0, spec.h || 0, 0);
    mesh.position.set(spec.x, spec.y, spec.z);
    scene.add(mesh);
    const r = {
      mesh, x: spec.x, y: spec.y, z: spec.z, h: spec.h || 0, pitch: spec.pitch || 0,
      v0: Math.max(0, spec.v0 || 0), size: spec.size || 2.4, age: 0, trail: 0,
      mine: !!spec.mine, owner: spec.owner || null,
      power: _clamp(Number(spec.power) || 1, 0.3, 4),                 // kuch ko'paytirgichi
      blast: _clamp(Number(spec.blast) || BLAST_DEFAULT, 3, 80),      // portlash radiusi (m)
      infinite: !!spec.infinite,                                      // true = masofa/vaqt/chegara cheklovi yo'q: nimagadir tegmaguncha uchadi
      heavy: !!spec.heavy,                                            // true = mashinalarni oddiydan ham kuchli pachoqlaydi
      range: spec.infinite ? 0 : (Number(spec.range) > 0 ? Number(spec.range) : 0),   // uchish masofasi (m), 0 = cheklanmagan (faqat vaqt bilan)
      travel: 0,
    };
    r.life = r.infinite ? 180 : r.range ? Math.max(ROCKET_LIFE, r.range / (ROCKET_BOOST * r.power) * 1.5 + 1) : ROCKET_LIFE;
    rockets.push(r);
    // Chiqish paytidagi tutun
    for (let i = 0; i < 8; i++) {
      puff(r.x, r.y, r.z, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3,
        1.2, 0.5, 2.4, 0.5, 0xeeeeee, 0x888888, 0, 1);
    }
    return r;
  }

  function updateRockets(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.age += dt;
      const speed = r.v0 + ROCKET_BOOST * r.power * Math.min(1, r.age / 0.4);
      const cp = Math.cos(r.pitch);
      const dx = Math.sin(r.h) * cp, dy = -Math.sin(r.pitch), dz = Math.cos(r.h) * cp;
      const dist = speed * dt;
      const n = Math.max(1, Math.ceil(dist / 1.0));   // har 1 m da tekshiramiz - tez uchsa ham devordan o'tib ketmasin
      const sx = dx * dist / n, sy = dy * dist / n, sz = dz * dist / n;
      let boom = null;
      for (let k = 0; k < n; k++) {
        r.x += sx; r.y += sy; r.z += sz;
        r.travel += dist / n;
        if (r.range && r.travel >= r.range) { boom = { x: r.x, y: r.y, z: r.z, kind: 'air' }; break; }   // belgilangan masofada portlaydi
        if (!r.infinite && !inBounds(r.x, r.z)) { boom = { x: r.x, y: r.y, z: r.z, kind: 'air' }; break; }
        const hit = collide(r.x, r.y, r.z, r);
        if (hit) { boom = hit; break; }
      }
      if (!boom && r.age >= r.life) boom = { x: r.x, y: r.y, z: r.z, kind: 'air' };
      if (boom) {
        scene.remove(r.mesh);
        rockets.splice(i, 1);
        explode(boom.x, boom.y, boom.z, boom.kind, { blast: r.blast, power: r.power });
        onExplode(boom, r);
        continue;
      }
      r.mesh.position.set(r.x, r.y, r.z);
      const flame = r.mesh.userData.flame;
      if (flame) flame.scale.set(1, 1, 0.8 + Math.random() * 0.7);
      r.trail -= dt;
      while (r.trail <= 0) {
        r.trail += 0.03;
        const tx = r.x - dx * r.size * 0.55, ty = r.y - dy * r.size * 0.55, tz = r.z - dz * r.size * 0.55;
        puff(tx, ty, tz, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8 + 0.4, (Math.random() - 0.5) * 0.8,
          1.8, 0.2 * r.size / 2.4, 1.5, 0.5, 0xe6e6e6, 0x777777, 0, 0.6);
        puff(tx, ty, tz, 0, 0, 0, 0.18, 0.3 * r.size / 2.4, 0.1, 0.9, 0xffd27a, 0xff5a10, 0, 0);
      }
    }
  }

  function update(dt) {
    clock += dt;
    updateRockets(dt);
    updateBlasts(dt);
    updateParticles(dt);
    updateScorches();
    shake *= Math.exp(-shakeDecay * dt);
  }

  // Kamera silkinishi: har freymda kamera joylangandan KEYIN chaqiriladi.
  function applyShake() {
    if (shake < 0.01) return;
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
  }

  // Tashqaridan tutun chiqarish (yonayotgan mashina uchun)
  function smoke(x, y, z) {
    puff(x + (Math.random() - 0.5) * 1.2, y, z + (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 0.8, 2.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8,
      3, 0.7, 3.2, 0.55, 0x3d3a37, 0x151413, 0, 0.2);
  }

  return { fire, update, applyShake, explode, addScorch, smoke, get clock() { return clock; } };
}
