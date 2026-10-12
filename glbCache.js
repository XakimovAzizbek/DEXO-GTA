// DEXO GTA: GLB fayllarni (mashina, samolyot/vertolyot, shahar) birinchi yuklangandan keyin
// IndexedDB'ga saqlaydi - keyingi safar o'yin ochilganda qayta yuklanmaydi, darhol xotiradan olinadi.
// IndexedDB tanlangan sababi: Service Worker'dan farqli, deyarli barcha brauzer va WebView'larda
// (Chrome, Safari, Telegram ichki brauzeri, Telegram Mini App) ishonchli ishlaydi.
// Agar biror sababga ko'ra IndexedDB mavjud bo'lmasa (masalan juda eski muhit), funksiyalar jim
// tarzda oddiy tarmoqdan yuklashga qaytadi - o'yin baribir ishlayveradi, faqat kesh bo'lmaydi.

const DB_NAME = 'dexo-gta-cache';
const STORE = 'glb';
const DB_VERSION = 3;   // 3: yengillashtirilgan GLB uylar (kichik teksturalar) - eski og'ir keshni bir marta tozalash uchun

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB mavjud emas')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Eski versiyadagi hamma yozuvlarni o'chirib, toza boshlaymiz (oldin buzilib saqlangan nusxalar qolib ketmasin)
      if (req.result.objectStoreNames.contains(STORE)) req.result.deleteObjectStore(STORE);
      req.result.createObjectStore(STORE, { keyPath: 'url' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(url) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function dbPut(url, data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ url, data, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Xotira to'lgan yoki IndexedDB ishlamayapti - jim o'tkazib yuboramiz, o'yin kesh'siz davom etadi.
  }
}

// Content-Length header bo'lsa, haqiqiy yuklab olish foizini beradi (onProgress 0..1).
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    if (onProgress) onProgress(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(Math.min(1, loaded / total));
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged.buffer;
}

// Avval IndexedDB'dan qidiradi (bo'lsa - tarmoqqa chiqmasdan darhol qaytaradi).
// Topilmasa tarmoqdan yuklaydi, orqa fonda keshga yozadi (yozishni kutib turmaydi) va qaytaradi.
export async function cachedFetchArrayBuffer(url, onProgress) {
  const cached = await dbGet(url);
  if (cached) {
    if (onProgress) onProgress(1);
    return cached;
  }
  const buf = await fetchWithProgress(url, onProgress);
  dbPut(url, buf.slice(0));   // mustaqil nusxa: GLTFLoader/Draco qaytargan buferni "yeb qo'yishi" (detach) mumkin,
                               // shu sabab kesh buzilib qolgan edi - endi saqlanadigan nusxaga bu ta'sir qilmaydi
  return buf;
}

// Bitta buzilgan yozuvni keshdan olib tashlaydi (masalan parse muvaffaqiyatsiz bo'lsa, qaytadan yuklab olish uchun).
export async function evictGLBCache(url) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // jim o'tkazamiz
  }
}

// Sozlamalarda "Keshni tozalash" kabi tugma uchun - hozircha ixtiyoriy, chaqirilmasa ham ishlayveradi.
export async function clearGLBCache() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// =====================================================================================
// OLDINDAN YUKLASH: bosh sahifa ochilishi bilan hamma GLB fayllarni orqa fonda yuklab, IndexedDB'ga yozadi.
// Tartib: 1) zone.json dagi modellar  2) mashinalar (car.txt)  3) samolyot/vertolyotlar (airport.txt)
//         4) boshqa modellar (home-glb.txt, modellar.txt)
// Foiz BAYTLARDA hisoblanadi: jami hajm (hamma yuklanadigan fayllar yig'indisi) ichidan nechta bayt kelgani.
// Kesh kaliti o'yin ishlatadigan yo'l bilan bir xil bo'lishi shart (models.js dagi nomzod yo'llar bilan bir xil tartib).
// Yangi fayl loyihaga qo'shilsa (zone.json, car.txt, airport.txt, home-glb.txt, modellar.txt orqali) - avtomatik topiladi.
// =====================================================================================

async function dbHas(url) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count(url);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return false;
  }
}

// dbPut'dan farqi: xatoni yutib yubormaydi (xotira to'lganini bilish uchun).
async function dbPutStrict(url, data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ url, data, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saqlash bekor qilindi'));
  });
}

const PRELOAD_CONCURRENCY = 3;     // bir vaqtda nechta fayl yuklanadi (tartib baribir saqlanadi)
const PROBE_CONCURRENCY = 8;       // hajmni bilish uchun bir vaqtda nechta so'rov
const UNKNOWN_SIZE_GUESS = 5 * 1024 * 1024;   // server Content-Length bermasa taxminiy hajm

// models.js dagi nomzod yo'llar bilan bir xil bo'lishi kerak
const carPaths = (f) => [`cars/${f}`, f];
const airportPaths = (f) => [`airport/${f}`, `cars/${f}`, f];
const housePaths = (f) => (f.includes('/') ? [f] : [f, `assets/${f}`, `home/${f}`, `houses/${f}`, `models/${f}`, `cars/${f}`, `airport/${f}`]);

async function fetchText(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

function matchAll(text, re) {
  const out = [];
  for (const m of String(text).matchAll(re)) if (m[1]) out.push(m[1].trim());
  return [...new Set(out)];
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Fayl bormi va hajmi qancha (HEAD). Ba'zi serverlar HEAD'ni qo'llamaydi - u holda GET boshlab, darhol to'xtatamiz.
// Fayl topilmasa serverlar ko'pincha index.html (200) qaytaradi - uni ham "yo'q" deb hisoblaymiz.
async function probe(url) {
  const info = (res) => {
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) return null;
    return { url, size: Number(res.headers.get('content-length')) || 0 };
  };
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) return info(res);
    if (![400, 405, 501].includes(res.status)) return null;
    const ctrl = new AbortController();
    const res2 = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    const r = info(res2);
    ctrl.abort();
    return r;
  } catch {
    return null;
  }
}

// O'yin qaysi yo'lni ishlatsa o'shani topadi: nomzodlar ichidan birinchi mavjudi (keshda bo'lsa - keshdagisi).
async function resolveFirst(candidates) {
  for (const url of candidates) {
    if (await dbHas(url)) return { url, cached: true, size: 0 };
    const info = await probe(url);
    if (info) return { ...info, cached: false };
  }
  return null;
}

async function downloadToCache(item, onChunk) {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${item.url}`);
  let merged;
  if (!res.body || !res.body.getReader) {
    merged = new Uint8Array(await res.arrayBuffer());
    item.loaded = merged.length;
    onChunk();
  } else {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      item.loaded = loaded;
      onChunk();
    }
    merged = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  }
  if (/\.glb$/i.test(item.url)) {
    const ok = merged.length > 12 && merged[0] === 0x67 && merged[1] === 0x6c && merged[2] === 0x54 && merged[3] === 0x46;   // "glTF"
    if (!ok) throw new Error(`GLB emas yoki buzilgan: ${item.url}`);
  }
  await dbPutStrict(item.url, merged.buffer);
}

// onUpdate({ state, percent, loaded, total, group, failed, lowStorage })
//   state: 'scanning' | 'downloading' | 'done' | 'cached' (hammasi oldindan yuklangan) | 'nothing' | 'offline'
// options.includeCity: true bo'lsa shahar modeli (assets/procedural_city_6.glb) ham yuklanadi.
export async function preloadAllGLB(onUpdate, options = {}) {
  const emit = (p) => { try { if (onUpdate) onUpdate(p); } catch { /* UI xatosi yuklashni to'xtatmasin */ } };
  if (!('indexedDB' in window)) { emit({ state: 'nothing', percent: 0, loaded: 0, total: 0 }); return { ok: false, failed: 0 }; }
  emit({ state: 'scanning', percent: 0, loaded: 0, total: 0, group: 'Fayllar tekshirilmoqda…' });

  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* muhim emas */ }

  // 1) Qaysi fayllar bor - ro'yxatlarni o'qiymiz
  const [zoneText, carText, airText, houseText, modelText] = await Promise.all([
    fetchText('zone.json'), fetchText('car.txt'), fetchText('airport.txt'), fetchText('home-glb.txt'), fetchText('modellar.txt'),
  ]);
  const stripComments = (t) => String(t).split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  const zoneFiles = matchAll(zoneText, /"([^"\\]+\.glb)"/gi);
  const groups = [
    { name: 'Zona modellari', lists: zoneFiles.map(housePaths) },
    { name: 'Mashinalar', lists: matchAll(stripComments(carText), /^\s*car\s*:\s*(.+?)\s*$/gim).map(carPaths) },
    { name: 'Samolyot va vertolyotlar', lists: matchAll(stripComments(airText), /^\s*(?:airplane|helicopter)\s*:\s*(.+?)\s*$/gim).map(airportPaths) },
    {
      name: 'Boshqa modellar',
      lists: [
        ...matchAll(stripComments(houseText), /\bglb\s*:\s*([^\s#]+)/gi),
        ...matchAll(stripComments(modelText), /\bglb\s*:\s*([^\s#]+)/gi),
      ].map(housePaths),
    },
  ];
  if (options.includeCity) groups[0].lists.push(['assets/procedural_city_6.glb']);

  // 2) Har bir fayl uchun haqiqiy yo'l va hajmini aniqlaymiz (tartib saqlanadi)
  const jobs = [];
  groups.forEach((g, gi) => g.lists.forEach((cands) => jobs.push({ gi, cands })));
  const resolved = await mapPool(jobs, PROBE_CONCURRENCY, (j) => resolveFirst(j.cands));

  const seen = new Set();
  const items = [];
  resolved.forEach((r, i) => {
    if (!r || r.cached || seen.has(r.url)) return;
    seen.add(r.url);
    items.push({ url: r.url, size: r.size, group: groups[jobs[i].gi].name, loaded: 0, done: false, failed: false });
  });

  if (!items.length) {
    const anyFound = resolved.some(Boolean);
    const state = anyFound ? 'cached' : (navigator.onLine === false ? 'offline' : 'nothing');
    emit({ state, percent: anyFound ? 100 : 0, loaded: 0, total: 0 });
    return { ok: anyFound, failed: 0 };
  }

  // 3) Jami hajm va foiz
  const totalOf = (it) => (it.done ? it.loaded : Math.max(it.size || UNKNOWN_SIZE_GUESS, it.loaded));
  let shownPercent = 0;
  let lastEmit = 0;
  let lowStorage = false;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const need = items.reduce((a, it) => a + (it.size || UNKNOWN_SIZE_GUESS), 0);
      if (est.quota && est.usage != null && need * 1.1 > est.quota - est.usage) lowStorage = true;
    }
  } catch { /* muhim emas */ }

  const snapshot = (force, finished) => {
    const now = Date.now();
    if (!force && now - lastEmit < 80) return;
    lastEmit = now;
    let loaded = 0, total = 0;
    for (const it of items) {
      const t = totalOf(it);
      total += t;
      loaded += it.done ? t : Math.min(it.loaded, t);
    }
    let pct = total ? Math.floor((loaded / total) * 100) : 0;
    if (!finished) pct = Math.min(pct, 99);          // 100% faqat hammasi tugagandagina
    shownPercent = Math.max(shownPercent, pct);       // qayta urinishda foiz orqaga qaytmasin
    const current = items.find((it) => !it.done && !it.failed);
    emit({
      state: finished ? 'done' : 'downloading',
      percent: finished ? 100 : shownPercent,
      loaded, total,
      group: current ? current.group : '',
      failed: items.filter((it) => it.failed).length,
      lowStorage,
    });
  };

  snapshot(true, false);

  // 4) Tartib bilan yuklaymiz (bir necha ishchi navbatdan ketma-ket oladi)
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const it = items[i];
      for (let attempt = 0; attempt < 3 && !it.done; attempt++) {
        try {
          it.loaded = 0;
          await downloadToCache(it, () => snapshot(false, false));
          it.done = true;
        } catch {
          if (attempt === 2) it.failed = true;
          else await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      snapshot(true, false);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, items.length) }, worker));

  const failed = items.filter((it) => it.failed).length;
  snapshot(true, true);
  return { ok: failed === 0, failed };
}
