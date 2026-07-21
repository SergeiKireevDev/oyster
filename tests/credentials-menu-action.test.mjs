import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCredentialsAssembly } from "../public/src/features/credentials/createCredentialsAssembly.js";
import { API_KEYS_OPEN_ACTION } from "../public/src/runtime/uiActionNames.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";

const menuSource = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
const rootSource = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");

test("menu exposes a top-level API Keys action through the scoped registry", () => {
  assert.match(menuSource, /data-action="apiKeys"[^>]*>API Keys…<\/button>/);
  assert.match(menuSource, /uiActions\.invoke\(API_KEYS_OPEN_ACTION\)/);
  assert.doesNotMatch(menuSource, /SettingsModal|localStorage|fetch\(/);
});

test("credentials assembly owns API-key action registration and teardown", () => {
  const uiActions = createUiActionRegistry();
  const opened = [];
  const assembly = createCredentialsAssembly({ uiActions, openModal: (state) => opened.push(state) });

  uiActions.invoke(API_KEYS_OPEN_ACTION);
  assert.deepEqual(opened, [{ title: "API Keys", wide: true, content: "apiKeys" }]);
  assembly.teardown();
  uiActions.invoke(API_KEYS_OPEN_ACTION);
  assert.equal(opened.length, 1);
  assembly.teardown();
});

test("application composition mounts credentials separately from settings and tears it down", () => {
  assert.match(rootSource, /createCredentialsAssembly\(\{ uiActions, openModal: openModalState \}\)/);
  assert.match(rootSource, /credentialsAssembly\.teardown\(\)/);
  assert.match(rootSource, /features: \{ credentials: credentialsAssembly\.operations \}/);
});
