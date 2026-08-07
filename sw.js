/* TURNIO RAIL · Service Worker (PWA instalable).
   Solo habilita “Instalar aplicación”. NO intercepta fetch:
   Radar/API/Supabase van directo por red (evita “Failed to fetch” intermitente). */
var CACHE = 'turnio-pwa-v2';
var PRECACHE = [
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    }).catch(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k === CACHE) return null;
        if (/mallas|gtfs|operativa/i.test(k)) return null;
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* Sin listener 'fetch': el navegador gestiona todas las peticiones. */
