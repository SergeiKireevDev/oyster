import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { registerServiceWorker } from "../public/src/runtime/registerServiceWorker.js";

const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const main = readFileSync(join(root, "public", "src", "main.js"), "utf8");
const viteConfig = readFileSync(join(root, "vite.config.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "public", "pwa", "manifest.webmanifest"), "utf8"));
const workerSource = readFileSync(join(root, "public", "pwa", "service-worker.js"), "utf8");

function pngDimensions(path) {
  const png = readFileSync(path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("document advertises the manifest and Apple standalone metadata", () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="theme-color" content="#0b0d12">/);
});

test("web app manifest is installable and references valid any and maskable icons", () => {
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0b0d12");

  const icons = new Map(manifest.icons.map((icon) => [`${icon.sizes}:${icon.purpose}`, icon]));
  for (const [key, expectedSize] of [["192x192:any", 192], ["512x512:any", 512], ["512x512:maskable", 512]]) {
    const icon = icons.get(key);
    assert.ok(icon, `missing ${key} icon`);
    assert.equal(icon.type, "image/png");
    assert.deepEqual(pngDimensions(join(root, "public", "pwa", icon.src)), [expectedSize, expectedSize]);
  }
  assert.deepEqual(pngDimensions(join(root, "public", "pwa", "icons", "apple-touch-icon.png")), [180, 180]);
});

test("Vite copies root-scoped PWA assets and production entry gives worker registration to the app lifecycle", () => {
  assert.match(viteConfig, /publicDir: "pwa"/);
  assert.match(main, /attachPageIntegrations: import\.meta\.env\.PROD \? registerServiceWorker : undefined/);
});

test("service worker registration waits for load, uses root scope, and exposes deterministic cleanup", async () => {
  let loadHandler;
  const calls = [];
  const windowTarget = {
    addEventListener(type, handler, options) { calls.push(["add", type, options]); loadHandler = handler; },
    removeEventListener(type, handler, options) { calls.push(["remove", type, handler === loadHandler, options]); },
  };
  const detach = registerServiceWorker({
    windowTarget,
    navigatorTarget: { serviceWorker: { register(...args) { calls.push(["register", ...args]); return Promise.resolve(); } } },
  });
  assert.deepEqual(calls, [["add", "load", { once: true }]]);
  loadHandler();
  await Promise.resolve();
  assert.deepEqual(calls[1], ["register", "/service-worker.js", { scope: "/" }]);

  detach();
  assert.deepEqual(calls[2], ["remove", "load", true, { once: true }]);
});

test("service worker caches only the app shell and keeps token-bearing URLs out of cache keys", async () => {
  const listeners = {};
  const puts = [];
  const cache = {
    async match() { return undefined; },
    async put(key) { puts.push(key); },
  };
  const context = {
    URL,
    Response,
    console,
    caches: { async open() { return cache; }, async keys() { return []; }, async delete() {} },
    fetch: async () => ({ ok: true, type: "basic", clone() { return this; } }),
    self: {
      location: { origin: "https://oyster.example" },
      addEventListener(type, handler) { listeners[type] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(workerSource, context, { filename: "service-worker.js" });

  let apiResponse;
  listeners.fetch({
    request: { method: "GET", mode: "cors", url: "https://oyster.example/rpc" },
    respondWith(value) { apiResponse = value; },
  });
  assert.equal(apiResponse, undefined, "authenticated API requests must stay network-only");

  let tokenAssetResponse;
  listeners.fetch({
    request: { method: "GET", mode: "cors", url: "https://oyster.example/assets/app.js?token=do-not-cache" },
    respondWith(value) { tokenAssetResponse = value; },
  });
  assert.equal(tokenAssetResponse, undefined, "token-bearing asset URLs must stay network-only");

  let navigationResponse;
  const navigationRequest = { method: "GET", mode: "navigate", url: "https://oyster.example/?token=do-not-cache" };
  listeners.fetch({ request: navigationRequest, respondWith(value) { navigationResponse = value; } });
  await navigationResponse;
  assert.deepEqual(puts, ["/"], "document responses use a credential-free cache key");
});
