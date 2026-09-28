/*
 * PSA150 service worker. Keeps the app and the songs and sets you have opened
 * on the phone, so the service view still works when the church Wi-Fi does not.
 *
 * - The page itself: network first, the saved copy when offline.
 * - /assets/ (hashed, never change): from the cache once saved.
 * - Song and set reads: network first; after a few seconds without an answer,
 *   or offline, the saved copy. The network answer still refreshes the cache.
 *   Requests made with `cache: "no-store"` (reads just before an edit) always
 *   go to the server.
 * - Everything else, and every write, goes straight to the server.
 *
 * Signing out deletes the "psa150-api" caches (see main.ts).
 */
const SHELL = "psa150-shell-v1";
const ASSETS = "psa150-assets";
const API = "psa150-api-v1";
const MAX_ASSETS = 40;
const NETWORK_WAIT_MS = 4000;

const CACHED_API = [
  /^\/api\/v1\/setup$/,
  /^\/api\/v1\/sets$/,
  /^\/api\/v1\/sets\/[0-9a-f-]{36}$/,
  /^\/api\/v1\/songs$/,
  /^\/api\/v1\/songs\/[0-9a-f-]{36}$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"]);
    // Save the current bundle too, so the app opens offline from the start.
    const page = await (await shell.match("/")).text();
    const assets = [...new Set(page.match(/\/assets\/[^"'\s)]+/g) ?? [])];
    await (await caches.open(ASSETS)).addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("psa150-") && ![SHELL, ASSETS, API].includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.cache === "no-store") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, SHELL, "/"));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(event));
  } else if (CACHED_API.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(networkFirst(event, API, request));
  }
});

async function networkFirst(event, cacheName, key) {
  const cache = await caches.open(cacheName);
  const network = fetch(event.request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(key, response.clone()));
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  const cached = await cache.match(key);
  if (!cached) return network;
  return Promise.race([
    // A 5xx is the tunnel or proxy saying the server is down: use the copy.
    network.then((response) => (response.status >= 500 ? cached : response), () => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS)),
  ]);
}

async function cacheFirst(event) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()).then(() => trim(cache)));
  return response;
}

/** Keeps the newest bundles; older deploys' files go first. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}
