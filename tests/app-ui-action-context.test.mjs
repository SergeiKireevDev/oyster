import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";

const appSource = readFileSync(new URL("../public/src/App.svelte", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");

test("App provides its UI action registry and passes it to the runtime", () => {
  assert.match(appSource, /provideUiActionRegistry\(createUiActionRegistry\(\)\)/);
  assert.match(appSource, /startAppRuntime\(\{ uiActions \}\)/);
  assert.match(appSource, /uiActions\.teardown\(\)/);
});

test("Menu routes every action through the scoped registry", () => {
  assert.match(menuSource, /getUiActionRegistry\(\)/);
  assert.match(menuSource, /uiActions\.invoke\(MENU_ACTION, action\)/);
  assert.doesNotMatch(menuSource, /window\.dispatchEvent|pi-menu-action/);
  assert.deepEqual(
    [...menuSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ["newSession", "newSessionIn", "sessions", "compact", "settings", "restart", "logout"],
  );
});

test("application mount teardown remount passes a fresh UI action registry", async () => {
  const received = [];
  const start = createAppRuntimeStarter({
    browser: {},
    stores: {},
    async loadDependencies() {
      return {
        createApplicationRuntimeDependencies(_browser, services) {
          received.push(services.uiActions);
          return {
            attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {},
          };
        },
      };
    },
  });

  const firstRegistry = createUiActionRegistry();
  firstRegistry.register("mounted", () => "first");
  const unmountFirst = await start({ uiActions: firstRegistry });
  unmountFirst();
  firstRegistry.teardown();

  const secondRegistry = createUiActionRegistry();
  secondRegistry.register("mounted", () => "second");
  const unmountSecond = await start({ uiActions: secondRegistry });

  assert.deepEqual(received, [firstRegistry, secondRegistry]);
  assert.notEqual(firstRegistry, secondRegistry);
  assert.equal(firstRegistry.invoke("mounted"), undefined);
  assert.equal(secondRegistry.invoke("mounted"), "second");

  unmountSecond();
  secondRegistry.teardown();
});
