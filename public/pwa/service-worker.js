const CACHE_NAME = "oyster-shell-v1";
const APP_SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/runtime-config.js",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

function isCacheableStaticAsset(url) {
  return url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest";
}

async function putSuccessfulResponse(cache, request, cacheKey = request) {
  const response = await fetch(request);
  if (response.ok && response.type !== "opaque") {
    // Cache quota failures must never turn a successful network request into
    // an application failure (large optional assets can exceed mobile quotas).
    try { await cache.put(cacheKey, response.clone()); } catch {}
  }
  return response;
}

async function cacheDocumentAssets(cache) {
  const documentResponse = await cache.match("/");
  if (!documentResponse) return;
  const html = await documentResponse.text();
  const assetUrls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && isCacheableStaticAsset(url));
  await Promise.allSettled(assetUrls.map((url) => putSuccessfulResponse(cache, url.href)));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL_URLS.map((url) => putSuccessfulResponse(cache, url)));
    await cacheDocumentAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("oyster-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl = request, cacheKey = request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    return await putSuccessfulResponse(cache, request, cacheKey);
  } catch {
    return (await cache.match(fallbackUrl)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(request)) ?? putSuccessfulResponse(cache, request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Every document is the same app shell. Keep query credentials and
    // permalink paths out of Cache Storage by writing only to the root key.
    event.respondWith(networkFirst(request, "/", "/"));
    return;
  }

  // Query tokens are accepted for GET authentication. They must never become
  // part of a Cache Storage key, even on otherwise static-looking requests.
  if (url.searchParams.has("token")) return;

  if (url.pathname === "/runtime-config.js") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request, url.pathname, url.pathname));
  }
});
