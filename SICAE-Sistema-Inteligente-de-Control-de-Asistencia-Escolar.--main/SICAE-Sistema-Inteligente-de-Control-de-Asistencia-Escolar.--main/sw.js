const CACHE_NAME = "asistencia-escolar-cache-v1";

const FILES_TO_CACHE = [
  "/victory-gym-web/",
  "/victory-gym-web/index.html",
  "/victory-gym-web/respaldo%205/",
  "/victory-gym-web/respaldo%205/index.html",
  "/victory-gym-web/respaldo%205/registro.html",
  "/victory-gym-web/respaldo%205/historial.html",
  "/victory-gym-web/respaldo%205/css/styles.css",
  "/victory-gym-web/respaldo%205/js/storage.js",
  "/victory-gym-web/respaldo%205/js/asistencias.js",
  "/victory-gym-web/respaldo%205/js/realtime.js",
  "/victory-gym-web/respaldo%205/js/nfc.js",
  "/victory-gym-web/respaldo%205/img/logo.png",
  "/victory-gym-web/respaldo%205/plantillas/plantilla_alumnos_cecyte.xlsx"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).catch(() =>
        caches.match("/victory-gym-web/respaldo%205/index.html")
      );
    })
  );
});
