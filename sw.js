// 圏外でも開くための Service Worker。下の VERSION と ASSETS の中身は build.py が埋める。
// アプリの版（app\ の中身のハッシュ）が変わったときだけこのファイルの中身が変わり、ブラウザが入れ替える。
// data.enc と version.json はここでは持たない（アプリが端末の保存先に持ち、更新を自分で確かめる）
const VERSION = 'bba02b092d';
const CACHE = 'slot-memo-' + VERSION;
const ASSETS = ["./", "./css/app.css", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./index.html", "./js/app.js", "./js/catalog.js", "./js/crypto.js", "./js/db.js", "./js/juggler.js", "./js/nav.js", "./js/numpad.js", "./js/search.js", "./js/ui.js", "./js/views/backcalc.js", "./js/views/judge.js", "./js/views/machines.js", "./js/views/records.js", "./js/views/settings.js", "./manifest.webmanifest"];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // ブラウザのキャッシュ（GitHub Pages は10分）を通さず、必ず取り直す
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('slot-memo-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // 画面は1枚なので、どの URL で開いても手元の index.html を返す
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then(res => res || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(res => res || fetch(req)));
});
