import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import { createDialogService } from "../public/src/runtime/dialogService.js";
import { createCheckpointModelPickerService } from "../public/src/runtime/checkpointModelPickerService.js";

const appSource = readFileSync(new URL("../public/src/App.svelte", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../public/src/components/CommandPalette.svelte", import.meta.url), "utf8");

test("App provides its UI action registry and passes it to the runtime", () => {
  assert.match(appSource, /provideUiActionRegistry\(createUiActionRegistry\(\)\)/);
  assert.match(appSource, /startAppRuntime\(\{ uiActions, dialogs, browserActions, checkpointModelPicker \}\)/);
  assert.match(appSource, /uiActions\.teardown\(\)/);
});

test("Menu routes every action through the scoped registry", () => {
  assert.match(menuSource, /getUiActionRegistry\(\)/);
  assert.match(menuSource, /uiActions\.invoke\(MENU_ACTION, action\)/);
  assert.doesNotMatch(menuSource, /window\.dispatchEvent|CustomEvent/);
  assert.deepEqual(
    [...menuSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ["compact", "analytics", "credentials", "settings", "restart", "logout"],
  );
});

test("CommandPalette routes mouse selection through the scoped registry", () => {
  assert.match(commandPaletteSource, /onmousedown=\{\(event\) => choose\(event, i\)\}/);
  assert.match(commandPaletteSource, /uiActions\.invoke\(COMMAND_PALETTE_RUN_ACTION, index\)/);
  assert.doesNotMatch(commandPaletteSource, /window\.dispatchEvent|CustomEvent/);
});

test("App provides scoped dialog and browser action services", () => {
  assert.match(appSource, /provideDialogService\(createDialogService\(\)\)/);
  assert.match(appSource, /provideBrowserActions\(createBrowserActions\(\{ windowTarget: window \}\)\)/);
  assert.match(appSource, /provideSettingsPreferences\(createSettingsPreferenceService\(/);
  assert.match(appSource, /onThinkingVisibilityChanged: \(\) => uiActions\.invoke\(SETTINGS_CHANGED_ACTION\)/);
  assert.match(appSource, /provideCheckpointModelPicker\(createCheckpointModelPickerService\(/);
  assert.match(appSource, /provideAuthBrowser\(createAuthBrowserService\(\{ storage: localStorage, reload: \(\) => location\.reload\(\) \}\)\)/);
  assert.match(appSource, /checkpointModelPicker\.teardown\(\)/);
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
          received.push({ uiActions: services.uiActions, dialogs: services.dialogs, checkpointModelPicker: services.checkpointModelPicker });
          return {
            attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {},
          };
        },
      };
    },
  });

  const firstRegistry = createUiActionRegistry();
  const firstDialogs = createDialogService();
  const firstPicker = createCheckpointModelPickerService();
  firstRegistry.register("mounted", () => "first");
  firstDialogs.setTextPrompt({ title: "First", placeholder: "", value: "" });
  const unmountFirst = await start({ uiActions: firstRegistry, dialogs: firstDialogs, checkpointModelPicker: firstPicker });
  unmountFirst();
  firstDialogs.teardown();
  firstPicker.teardown();
  firstRegistry.teardown();

  const secondRegistry = createUiActionRegistry();
  const secondDialogs = createDialogService();
  const secondPicker = createCheckpointModelPickerService();
  secondRegistry.register("mounted", () => "second");
  const unmountSecond = await start({ uiActions: secondRegistry, dialogs: secondDialogs, checkpointModelPicker: secondPicker });

  assert.deepEqual(received, [
    { uiActions: firstRegistry, dialogs: firstDialogs, checkpointModelPicker: firstPicker },
    { uiActions: secondRegistry, dialogs: secondDialogs, checkpointModelPicker: secondPicker },
  ]);
  assert.notEqual(firstRegistry, secondRegistry);
  assert.notEqual(firstDialogs, secondDialogs);
  assert.notEqual(firstPicker, secondPicker);
  assert.equal(firstRegistry.invoke("mounted"), undefined);
  assert.equal(secondRegistry.invoke("mounted"), "second");

  unmountSecond();
  secondDialogs.teardown();
  secondPicker.teardown();
  secondRegistry.teardown();
});
