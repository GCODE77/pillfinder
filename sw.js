// 오프라인 캐시. 앱 파일을 고치면 CACHE 번호를 올려야 사용자에게 새 버전이 간다.
const CACHE = 'pillfinder-v1.4.0';
const SHELL = [
  './', 'index.html', 'app.js', 'vision.js', 'vision-worker.js', 'match.js', 'ocr.js', 'ai.js', 'share.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/favicon-32.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/lang/eng.traineddata.gz',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 약 사진(식약처)·API는 그대로
  // 데이터는 새것 우선(오프라인이면 캐시), 앱 파일은 캐시 우선
  const isData = url.pathname.includes('/data/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isData) {
      try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
      catch { const c = await cache.match(e.request); if (c) return c; throw new Error('offline'); }
    }
    const c = await cache.match(e.request, { ignoreSearch: true });
    if (c) return c;
    const r = await fetch(e.request);
    if (r.ok && /\/vendor\/|\.wasm$/.test(url.pathname)) cache.put(e.request, r.clone());
    return r;
  })());
});
