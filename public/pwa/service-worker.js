const CACHE_NAME = "oyster-shell-v2";
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

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === "visible")) return;
    let payload = {};
    try { payload = event.data?.json() ?? {}; } catch {}
    const url = typeof payload.url === "string" && payload.url.startsWith("/") && !payload.url.startsWith("//") ? payload.url : "/";
    await self.registration.showNotification(payload.title || "Oyster", {
      body: payload.body || "Oyster needs your attention.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "oyster-attention",
      renotify: true,
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).pathname === new URL(target).pathname);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});

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
