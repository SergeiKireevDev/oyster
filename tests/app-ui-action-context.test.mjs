import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import { createDialogService } from "../public/src/runtime/dialogService.js";
import { createCheckpointModelPickerService } from "../public/src/runtime/checkpointModelPickerService.js";

const appSource = readFileSync(new URL("../public/src/App.svelte", import.meta.url), "utf8");
const scopeSource = readFileSync(new URL("../public/src/runtime/createBrowserApplicationScope.js", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../public/src/components/CommandPalette.svelte", import.meta.url), "utf8");

test("App provides its scoped UI action registry and starts the application scope", () => {
  assert.match(appSource, /provideUiActionRegistry\(applicationScope\.services\.uiActions\)/);
  assert.match(appSource, /applicationScope\.start\(\)\.catch\(\(error\) => \{/);
  assert.match(appSource, /console\.error\("Application startup failed", error\)/);
  assert.match(appSource, /return \(\) => applicationScope\.teardown\(\)/);
  assert.match(scopeSource, /startRuntime\(\{ uiActions, dialogs, browserActions, checkpointModelPicker \}\)/);
  assert.match(scopeSource, /uiActions\.teardown\(\)/);
});

test("Menu routes every action through the scoped registry", () => {
  assert.match(menuSource, /getUiActionRegistry\(\)/);
  assert.match(menuSource, /uiActions\.invoke\(MENU_ACTION, action\)/);
  assert.doesNotMatch(menuSource, /window\.dispatchEvent|CustomEvent|Compact context|data-action="compact"|Restart pi process|data-action="restart"/);
  assert.deepEqual(
    [...menuSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ["analytics", "credentials", "settings", "logout"],
  );
  for (const icon of ["analytics", "key", "settings", "logout"]) {
    assert.match(menuSource, new RegExp(`<AppIcon name="${icon}"`));
  }
  assert.match(menuSource, />Log out<\/span>/);
});

test("Header presents session controls as a consistent icon action group", () => {
  assert.match(headerSource, /<nav class="header-actions" aria-label="Session controls">/);
  for (const icon of ["fork", "sliders", "model", "thinking", "more"]) {
    assert.match(headerSource, new RegExp(`<AppIcon name="${icon}"`));
  }
  assert.match(headerSource, /<h1 class="title" id="sessionTitle"/);
  assert.match(headerSource, /class="header-status" role="status" aria-atomic="true"/);
  assert.match(headerSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("CommandPalette routes native activation through the scoped registry", () => {
  assert.match(commandPaletteSource, /onclick=\{\(\) => choose\(i\)\}/);
  assert.match(commandPaletteSource, /onmousedown=\{keepComposerFocus\}/);
  assert.match(commandPaletteSource, /uiActions\.invoke\(COMMAND_PALETTE_RUN_ACTION, index\)/);
  assert.doesNotMatch(commandPaletteSource, /window\.dispatchEvent|CustomEvent/);
});

test("App provides scoped services without constructing browser or persistence adapters", () => {
  assert.match(appSource, /provideDialogService\(applicationScope\.services\.dialogs\)/);
  assert.match(appSource, /provideBrowserActions\(applicationScope\.services\.browserActions\)/);
  assert.match(appSource, /provideSettingsPreferences\(applicationScope\.services\.settingsPreferences\)/);
  assert.match(appSource, /provideCheckpointModelPicker\(applicationScope\.services\.checkpointModelPicker\)/);
  assert.match(appSource, /provideAuthBrowser\(applicationScope\.services\.authBrowser\)/);
  assert.match(appSource, /provideWorkspaceService\(applicationScope\.services\.workspaceService\)/);
  assert.doesNotMatch(appSource, /localStorage|\bwindow\b|\bdocument\b|createBrowserActions|createAuthBrowserService/);
  assert.match(scopeSource, /onThinkingVisibilityChanged: \(\) => uiActions\.invoke\(SETTINGS_CHANGED_ACTION\)/);
  assert.match(scopeSource, /checkpointModelPicker\.teardown\(\)/);
  assert.match(scopeSource, /dialogs\.teardown\(\)/);
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
