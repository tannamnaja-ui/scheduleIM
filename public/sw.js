// Service worker: เปิดแอปได้แม้ออฟไลน์ (ใช้ข้อมูลล่าสุดที่เคยโหลด)
const VERSION = '__BUILD__'; // GitHub Actions แทนค่าด้วย commit ทุกครั้งที่ deploy -> มือถืออัปเดตแอปเอง
const CACHE = 'schedule-im-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './config.js', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ฟอนต์: ใช้จาก cache ก่อน
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;

  // ไฟล์ของแอปและข้อมูล: ดึงจากเน็ตก่อน ถ้าออฟไลน์ใช้ของใน cache
  const key = url.pathname.endsWith('data.json') ? new Request(url.origin + url.pathname) : req;
  const fresh = new Request(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))));
});
