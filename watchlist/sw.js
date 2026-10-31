const CACHE = "watchlist-v6";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "palette.js",
  "melt.js",
  "fonts/courier-prime-400-latin.woff2",
  "fonts/courier-prime-400-latin-ext.woff2",
  "fonts/courier-prime-700-latin.woff2",
  "fonts/courier-prime-700-latin-ext.woff2",
  "app.js",
  "profiles.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

// Network first so a refreshed watchlist shows up on the next launch with a connection.
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("index.html");
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const isPoster = url.pathname.includes("/posters/");
  event.respondWith(isPoster ? cacheFirst(event.request) : networkFirst(event.request));
});
