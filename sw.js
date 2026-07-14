const CACHE = "online-befehl-v2";
const SHELL = [
  "./index.html", "./ris.html",
  "./css/style.css", "./css/ris.css",
  "./js/app.js", "./js/ris.js", "./js/katalog.js", "./js/firebase-config.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Netzwerk zuerst (Firebase-Daten sollen immer aktuell sein), Cache nur als Fallback fürs App-Shell
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
