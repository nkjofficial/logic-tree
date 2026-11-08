/* ロジックツリー スマホ版 Service Worker
   アプリ本体を端末に保存し、通信なしでも起動できるようにする。
   新しい版は自動では切り替えず、画面の「更新する」を押したときだけ切り替える。
   アプリを更新するときは VERSION を変えること。 */
'use strict';
const VERSION = '1.0.5';
const CACHE = 'logic-tree-' + VERSION;
const FILES = ['./', 'index.html', 'core.js', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('logic-tree-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // 画面の読み込み（?standalone などの付いたURLも含む）は index.html を返す
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx; } throw err; }
  })());
});
