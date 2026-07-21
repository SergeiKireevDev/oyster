import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import { createDialogService } from "../public/src/runtime/dialogService.js";

const appSource = readFileSync(new URL("../public/src/App.svelte", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../public/src/components/CommandPalette.svelte", import.meta.url), "utf8");

test("App provides its UI action registry and passes it to the runtime", () => {
  assert.match(appSource, /provideUiActionRegistry\(createUiActionRegistry\(\)\)/);
  assert.match(appSource, /startAppRuntime\(\{ uiActions, dialogs, browserActions \}\)/);
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

test("CommandPalette routes mouse selection through the scoped registry", () => {
  assert.match(commandPaletteSource, /onmousedown=\{\(event\) => choose\(event, i\)\}/);
  assert.match(commandPaletteSource, /uiActions\.invoke\(COMMAND_PALETTE_RUN_ACTION, index\)/);
  assert.doesNotMatch(commandPaletteSource, /window\.dispatchEvent|pi-command-palette-run/);
});

test("App provides scoped dialog and browser action services", () => {
  assert.match(appSource, /provideDialogService\(createDialogService\(\)\)/);
  assert.match(appSource, /provideBrowserActions\(createBrowserActions\(\{ windowTarget: window \}\)\)/);
  assert.match(appSource, /dialogs\.teardown\(\)/);
});

test("application mount teardown remount passes fresh scoped UI services", async () => {
  const received = [];
  const start = createAppRuntimeStarter({
    browser: {},
    stores: {},
    async loadDependencies() {
      return {
        createApplicationRuntimeDependencies(_browser, services) {
          received.push({ uiActions: services.uiActions, dialogs: services.dialogs });
          return {
            attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {},
          };
        },
      };
    },
  });

  const firstRegistry = createUiActionRegistry();
  const firstDialogs = createDialogService();
  firstRegistry.register("mounted", () => "first");
  firstDialogs.setTextPrompt({ title: "First", placeholder: "", value: "" });
  const unmountFirst = await start({ uiActions: firstRegistry, dialogs: firstDialogs });
  unmountFirst();
  firstDialogs.teardown();
  firstRegistry.teardown();

  const secondRegistry = createUiActionRegistry();
  const secondDialogs = createDialogService();
  secondRegistry.register("mounted", () => "second");
  const unmountSecond = await start({ uiActions: secondRegistry, dialogs: secondDialogs });

  assert.deepEqual(received, [
    { uiActions: firstRegistry, dialogs: firstDialogs },
    { uiActions: secondRegistry, dialogs: secondDialogs },
  ]);
  assert.notEqual(firstRegistry, secondRegistry);
  assert.notEqual(firstDialogs, secondDialogs);
  assert.equal(firstRegistry.invoke("mounted"), undefined);
  assert.equal(secondRegistry.invoke("mounted"), "second");

  unmountSecond();
  secondDialogs.teardown();
  secondRegistry.teardown();
});
