// DEXO GTA: LOD bot floti. Yaqin = GLB, uzoq = past-poly mashina.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LANE_OFFSET } from './data.js';

// ---------- Past-poly mashina (uzoq uchun, soddalashtirilgan shakl) ----------
function makeLowPolyCar() {
  const parts = [];
  const paint = (geo, hex) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i*3]=c.r; arr[i*3+1]=c.g; arr[i*3+2]=c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  };
  const box = (w,h,d,x,y,z,hex) => { const g=new THREE.BoxGeometry(w,h,d); g.translate(x,y,z); paint(g,hex); };
  const wheel = (x, z) => {
    const g = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10);
    g.rotateZ(Math.PI / 2);
    g.translate(x, 0.34, z);
    paint(g, '#1a1a1a');
  };

  // Pastki korpus
  box(1.8, 0.5, 4.0, 0, 0.6, 0, '#c0392b');
  // Kabina (kichikroq, orqaga siljigan)
  box(1.6, 0.55, 2.0, 0, 1.15, -0.3, '#c0392b');
  // Old oyna (qiya)
  const wf = new THREE.BoxGeometry(1.55, 0.5, 0.05);
  wf.rotateX(-0.35);
  wf.translate(0, 1.15, 0.72);
  paint(wf, '#1a2533');
  // Orqa oyna (qiya)
  const wr = new THREE.BoxGeometry(1.55, 0.5, 0.05);
  wr.rotateX(0.35);
  wr.translate(0, 1.15, -1.32);
  paint(wr, '#1a2533');
  // Yon oynalar
  box(0.04, 0.42, 1.7, 0.8, 1.15, -0.3, '#1a2533');
  box(0.04, 0.42, 1.7, -0.8, 1.15, -0.3, '#1a2533');
  // Tom
  box(1.58, 0.05, 2.0, 0, 1.44, -0.3, '#8b1a1a');
  // Bamperlar
  box(1.85, 0.18, 0.15, 0, 0.5, 2.05, '#1a1a1a');
  box(1.85, 0.18, 0.15, 0, 0.5, -2.05, '#1a1a1a');
  // Chiroqlar
  box(0.32, 0.14, 0.06, -0.55, 0.75, 2.03, '#fff4c0');
  box(0.32, 0.14, 0.06,  0.55, 0.75, 2.03, '#fff4c0');
  box(0.32, 0.14, 0.06, -0.55, 0.75, -2.03, '#ff3b30');
  box(0.32, 0.14, 0.06,  0.55, 0.75, -2.03, '#ff3b30');
  // G'ildiraklar
  wheel(-0.9, 1.3); wheel(0.9, 1.3);
  wheel(-0.9, -1.3); wheel(0.9, -1.3);

  const g = mergeGeometries(parts, false);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const LOW_COLORS = [
  '#c0392b','#2980b9','#f39c12','#27ae60','#8e44ad','#e74c3c',
  '#16a085','#d35400','#2c3e50','#7f8c8d','#c39bd3','#f1c40f',
];

async function makeLoader() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function loadGLB(loader, file) {
  for (const path of [`cars/${file}`, file]) {
    try { return await loader.loadAsync(path); } catch { }
  }
  return null;
}

function buildGLBSet(scene, gltf, capacity, targetLength = 4.5) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  const rotY = size.x > size.z ? Math.PI / 2 : 0;
  const zSize = Math.max(size.x, size.z);
  const scale = targetLength / zSize;

  const norm = new THREE.Matrix4();
  norm.makeTranslation(-center.x, -bbox.min.y, -center.z);
  norm.premultiply(new THREE.Matrix4().makeRotationY(rotY));
  norm.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));

  const meshes = [];
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    geo.applyMatrix4(norm);
    let mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    mat = mat.clone();
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.envMapIntensity = 0.5;
    const im = new THREE.InstancedMesh(geo, mat, capacity);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.count = 0;
    scene.add(im);
    meshes.push(im);
  });

  return { meshes };
}

export async function createBotFleet(scene, carFiles, capacity = 400) {
  const loader = await makeLoader();

  // GLB modellar (faqat yaqin uchun) — 2 ta yetarli
  const models = [];
  for (const file of carFiles.slice(0, 2)) {
    const gltf = await loadGLB(loader, file);
    if (gltf) models.push(gltf);
  }
  const glbSets = models.map(gltf => buildGLBSet(scene, gltf, capacity));

  // Past-poly (uzoq uchun)
  const lowGeo = makeLowPolyCar();
  const lowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lowMesh = new THREE.InstancedMesh(lowGeo, lowMat, capacity);
  lowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lowMesh.frustumCulled = false;
  lowMesh.count = 0;
  scene.add(lowMesh);

  const lowColors = new Float32Array(capacity * 3);
  lowMesh.instanceColor = new THREE.InstancedBufferAttribute(lowColors, 3);
  lowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  const bots = [];
  const dummy = new THREE.Object3D();

  return {
    bots, capacity, modelCount: glbSets.length,

    add(x, z, heading, route, modelIdx) {
      if (bots.length >= capacity) return null;
      const mIdx = modelIdx % Math.max(1, glbSets.length);
      const bot = {
        modelIdx: mIdx, x, z, heading: heading || 0,
        speed: 0, s: 0, lateral: LANE_OFFSET, lateralTarget: LANE_OFFSET,
        route, waitTimer: 0, overtaking: false, overtakeTimer: 0,
        color: LOW_COLORS[modelIdx % LOW_COLORS.length],
      };
      bots.push(bot);
      return bot;
    },

    // GLB_CAP + LOW_CAP: EKRANGA CHIQADIGAN uchburchaklar sonini QAT'IY chegaralaydi.
    // Necha yuz bot bitta yo'lga to'plansa ham, chizilayotgan mashina soni hech qachon shu sondan oshmaydi —
    // shuning uchun FPS bot umumiy soniga emas, faqat shu ikki songa bog'liq bo'lib qoladi.
    update(cameraX, cameraZ, obstacles, cfg, dt, stepFn) {
      const NEAR_DIST2 = 140 * 140;    // shu masofadan yaqin bo'lsa fizika har kadr hisoblanadi
      const FAR_RATE = 0.06;           // uzoqdagilar uchun kadr boshiga hisoblash ehtimoli (arzon, lekin tezligi saqlanadi)
      const GLB_DIST2 = 70 * 70;       // shundan yaqin bo'lsagina haqiqiy GLB bo'lib ko'rinadi
      const LOW_DIST2 = 220 * 220;     // shundan yaqin bo'lsa past-poly ko'rinadi (undan naridagilar tuman ichida, chizilmaydi)
      const GLB_CAP = Math.min(28, capacity);    // bir vaqtda ko'pi bilan shuncha bot to'liq GLB'da
      const LOW_CAP = Math.min(70, capacity);    // undan keyin yana shuncha bot past-poly'da

      // Fizika: yaqin — har kadr; uzoq — siyrak, lekin o'tgan vaqtni to'ldirib hisoblanadi (sekin ko'rinmasin)
      for (const bot of bots) {
        const dx = bot.x - cameraX, dz = bot.z - cameraZ;
        bot._d2 = dx * dx + dz * dz;
        if (bot._d2 < NEAR_DIST2) stepFn(bot, dt);
        else if (Math.random() < FAR_RATE) stepFn(bot, dt / FAR_RATE);
      }

      // Chizish: faqat eng yaqin GLB_CAP+LOW_CAP tasini tanlaymiz (qolganlari bu kadrda chizilmaydi)
      const candidates = bots.filter((b) => b._d2 < LOW_DIST2);
      candidates.sort((a, b) => a._d2 - b._d2);

      const glbCounts = new Array(glbSets.length).fill(0);
      let lowCount = 0;

      for (let i = 0; i < candidates.length && i < GLB_CAP + LOW_CAP; i++) {
        const bot = candidates[i];
        dummy.position.set(bot.x, 0, bot.z);
        dummy.rotation.set(0, bot.heading, 0);
        dummy.updateMatrix();

        if (i < GLB_CAP && bot._d2 <= GLB_DIST2 && glbSets.length > 0) {
          const gi = glbCounts[bot.modelIdx]++;
          for (const im of glbSets[bot.modelIdx].meshes) im.setMatrixAt(gi, dummy.matrix);
        } else if (lowCount < LOW_CAP) {
          lowMesh.setMatrixAt(lowCount, dummy.matrix);
          const c = new THREE.Color(bot.color);
          lowColors[lowCount * 3] = c.r;
          lowColors[lowCount * 3 + 1] = c.g;
          lowColors[lowCount * 3 + 2] = c.b;
          lowCount++;
        }
      }

      for (let i = 0; i < glbSets.length; i++) {
        for (const im of glbSets[i].meshes) {
          im.count = glbCounts[i];
          im.instanceMatrix.needsUpdate = true;
        }
      }

      lowMesh.count = lowCount;
      lowMesh.instanceMatrix.needsUpdate = true;
      lowMesh.instanceColor.needsUpdate = true;
    },

    dispose() {
      for (const set of glbSets) {
        for (const im of set.meshes) {
          scene.remove(im);
          im.geometry.dispose();
          im.material.dispose();
        }
      }
      scene.remove(lowMesh);
      lowGeo.dispose();
      lowMat.dispose();
    },
  };
}