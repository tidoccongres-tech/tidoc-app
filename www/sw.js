const CACHE_NAME = "tidoc-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/blog.html",
  "/galerie.html",
  "/evenements.html",
  "/style.css",
  "/script.js",
  "/auth.js",
  "/blog.js",
  "/galerie.js",
  "/evenements.js",
  "/firebase-config.js",
  "/manifest.webmanifest"
];

// Install: cache un minimum (sans forcer)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: nettoie anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch: IMPORTANT = ne pas intercepter Firebase/Google Auth
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne touche pas aux requêtes Firebase / Google / gstatic / cloudinary
  const bypass =
    url.hostname.includes("google") ||
    url.hostname.includes("gstatic") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("cloudinary");

  if (bypass) return;

  // Pour les pages HTML: Network-first (évite de rester bloquée sur une vieille version)
  const isHTML = event.request.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Pour le reste: Cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
      );
    })
  );
});
