// DEXO GTA: Service Worker. Ilova sahifalarini keshda saqlaydi (tezroq va internetsiz ochilishi uchun),
// lekin zona, mashina va ob-havo kabi doim yangilanib turadigan fayllarni HECH QACHON keshlamaydi —
// aks holda o'yinchilar siz saqlagan yangi zonani ko'rmay, eski nusxada qolib ketishi mumkin.
const VERSION = 'v1';
const CACHE_NAME = `dexo-gta-${VERSION}`;

// Ilovaning o'zi (HTML/CSS/JS): birinchi tashrifda oldindan keshlanadi
const APP_SHELL = [
  'index.html', 'index.css', 'index.js',
  'car.html', 'car.css', 'car.js',
  'car-editor.html', 'car-editor.css', 'car-editor.js',
  'editor.html', 'editor.css', 'editor.js',
  'game.html', 'game.css', 'game.js',
  'settings.html', 'settings.css', 'settings.js',
  'common.css', 'data.js', 'models.js', 'lights.js', 'weather.js', 'botFleet.js', 'savefile.js',
  'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
];

// Doim tarmoqdan olinadigan fayllar: zona, mashina va ob-havo sozlamalari.
// Bular tez-tez o'zgaradi (siz GitHub'ga yangi fayl yuklaganingizda), shuning uchun keshlanmasligi shart.
function isLiveData(url) {
  return /\/(zone\.json|car\.txt|bot-car\.txt|ob-havo\.txt|billboard\.txt)(\?|$)/i.test(url.pathname)
    || url.pathname.endsWith('.txt');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;             // saqlash so'rovlari (GitHub API PUT) servis workerga tegishli emas
  const url = new URL(req.url);

  // Boshqa saytlarga so'rovlar (GitHub API, tashqi rasm qidiruv va h.k.) — tegilmaydi
  const sameOrigin = url.origin === location.origin;

  if (sameOrigin && isLiveData(url)) {
    event.respondWith(fetch(req, { cache: 'no-store' }));   // doim eng yangisi
    return;
  }

  if (sameOrigin && (url.pathname.endsWith('.glb') || /\/cars\//.test(url.pathname))) {
    // Mashina/shahar modellari: og'ir va kamdan-kam o'zgaradi — birinchi yuklangach keshdan tez ochiladi
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  if (!sameOrigin) {
    // CDN (three.js, Google Fonts): versiyasi manzilga yozilgan, shuning uchun keshlash xavfsiz
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached)),
    );
    return;
  }

  // Ilovaning o'z sahifalari/kodi: avval tarmoqdan (eng yangi kod), tarmoq bo'lmasa keshdan
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('index.html'))),
  );
});
