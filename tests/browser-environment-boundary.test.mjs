import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveBrowserEnvironment } from "../public/src/runtime/browserEnvironment.js";
import { createBrowserAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";

test("browser environment resolution is inert during SSR", () => {
  assert.equal(resolveBrowserEnvironment({}), null);
  assert.equal(resolveBrowserEnvironment(null), null);
});

test("browser environment contains denied storage behind an in-memory adapter", () => {
  const documentTarget = {};
  const windowTarget = {
    location: { pathname: "/" },
    history: {},
    get localStorage() {
      throw new DOMException("denied", "SecurityError");
    },
  };

  const environment = resolveBrowserEnvironment({ window: windowTarget, document: documentTarget });
  assert.equal(environment.windowTarget, windowTarget);
  assert.equal(environment.documentTarget, documentTarget);
  environment.storage.setItem("setting", 42);
  assert.equal(environment.storage.getItem("setting"), "42");
  environment.storage.removeItem("setting");
  assert.equal(environment.storage.getItem("setting"), null);
});

test("runtime composition receives browser capabilities from the mount boundary", async () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  let receivedBrowser;
  const starter = createBrowserAppRuntimeStarter({
    windowTarget: { fetch() {} },
    documentTarget: { getElementById() {} },
    locationTarget: { pathname: "/" },
    historyTarget: {},
    storage,
    loadDependencies: async () => ({
      createApplicationRuntimeDependencies(browser) {
        receivedBrowser = browser;
        return {
          attachAuthenticatedFetch() {},
          attachEventAdapters() {},
          attachDebugHooks() {},
          start() {},
          teardown() {},
        };
      },
    }),
  });

  const stop = await starter();
  assert.equal(receivedBrowser.storage, storage);
  assert.equal(typeof receivedBrowser.find, "function");
  stop();
});

test("client entry and composition root do not capture implicit browser globals", () => {
  const main = readFileSync(new URL("../public/src/main.js", import.meta.url), "utf8");
  const composition = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");

  assert.match(main, /resolveBrowserEnvironment\(\)/);
  assert.doesNotMatch(main, /\b(?:window|document|location|history|localStorage)\b\s*[,.)]/);
  assert.match(composition, /const \{ window, document, location, history, storage, find \} = browser/);
  assert.doesNotMatch(composition, /\blocalStorage\b/);
});
