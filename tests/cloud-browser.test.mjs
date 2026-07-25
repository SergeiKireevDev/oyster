import test from "node:test";
import assert from "node:assert/strict";
import { createCloudBrowser } from "../public/src/features/cloud/cloudBrowser.js";

test("cloud browser adapter owns navigation, return routes, resume listeners, and clipboard", async () => {
  const listeners = new Map();
  const documentListeners = new Map();
  const calls = [];
  const target = {
    location: { href: "https://hub.example/?cloud-connect=flow#token=secret", assign: (url) => calls.push(["assign", url]) },
    history: { replaceState: (_state, _title, url) => calls.push(["replace", url]) },
    open: (...args) => calls.push(["open", ...args]),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    document: {
      hidden: false,
      addEventListener: (name, fn) => documentListeners.set(name, fn),
      removeEventListener: (name, fn) => { if (documentListeners.get(name) === fn) documentListeners.delete(name); },
    },
    navigator: { clipboard: { writeText: async (value) => calls.push(["copy", value]) } },
  };
  target.window = target;
  const browser = createCloudBrowser(target);
  assert.equal(browser.hasConnectionReturn(), true);
  assert.equal(browser.query("cloud-connect"), "flow");
  assert.equal(browser.handoffUrl("handoff").includes("token=secret"), false);
  browser.navigate("https://provider.example");
  browser.openExternal("https://console.example");
  browser.removeQuery("cloud-connect");
  await browser.copyText("one-time-url");
  const release = browser.onResume(() => {});
  assert.equal(listeners.has("focus"), true);
  assert.equal(documentListeners.has("visibilitychange"), true);
  release();
  assert.equal(listeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.deepEqual(calls.slice(0, 4), [
    ["assign", "https://provider.example"],
    ["open", "https://console.example", "_blank", "noopener,noreferrer"],
    ["replace", "/#token=secret"],
    ["copy", "one-time-url"],
  ]);
});
