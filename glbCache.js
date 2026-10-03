// DEXO GTA: GLB fayllarni (mashina, samolyot/vertolyot, shahar) birinchi yuklangandan keyin
// IndexedDB'ga saqlaydi - keyingi safar o'yin ochilganda qayta yuklanmaydi, darhol xotiradan olinadi.
// IndexedDB tanlangan sababi: Service Worker'dan farqli, deyarli barcha brauzer va WebView'larda
// (Chrome, Safari, Telegram ichki brauzeri, Telegram Mini App) ishonchli ishlaydi.
// Agar biror sababga ko'ra IndexedDB mavjud bo'lmasa (masalan juda eski muhit), funksiyalar jim
// tarzda oddiy tarmoqdan yuklashga qaytadi - o'yin baribir ishlayveradi, faqat kesh bo'lmaydi.

const DB_NAME = 'dexo-gta-cache';
const STORE = 'glb';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB mavjud emas')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'url' });
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
