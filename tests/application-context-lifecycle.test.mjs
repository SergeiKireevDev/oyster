import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserApplicationScope } from "../public/src/runtime/createBrowserApplicationScope.js";
import { SETTINGS_CHANGED_ACTION } from "../public/src/runtime/uiActionNames.js";

function createMountDependencies() {
  const values = new Map();
  return {
    values,
    dependencies: {
      windowTarget: { open() {}, fetch() {}, localStorage: null },
      documentTarget: {
        documentElement: { setAttribute() {} },
        querySelector: () => ({ setAttribute() {} }),
        getElementById: () => null,
      },
      locationTarget: { reload() {} },
      historyTarget: {},
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  };
}

test("application scope owns page listener attachment and deterministic cleanup", async () => {
  const browser = createMountDependencies();
  const calls = [];
  const scope = createBrowserApplicationScope({
    ...browser.dependencies,
    attachPageIntegrations() {
      calls.push("attach-page");
      return () => calls.push("detach-page");
    },
    createRuntimeStarter: () => async () => {
      calls.push("start-runtime");
      return () => calls.push("stop-runtime");
    },
  });

  await scope.start();
  await scope.start();
  assert.deepEqual(calls, ["attach-page", "start-runtime"]);

  scope.teardown();
  scope.teardown();
  assert.deepEqual(calls, ["attach-page", "start-runtime", "stop-runtime", "detach-page"]);
});

test("application context services are isolated per mount and release mutable callbacks on teardown", async () => {
  const firstBrowser = createMountDependencies();
  const secondBrowser = createMountDependencies();
  firstBrowser.dependencies.windowTarget.localStorage = firstBrowser.dependencies.storage;
  secondBrowser.dependencies.windowTarget.localStorage = secondBrowser.dependencies.storage;

  const first = createBrowserApplicationScope(firstBrowser.dependencies);
  const second = createBrowserApplicationScope(secondBrowser.dependencies);

  for (const name of Object.keys(first.services)) {
    assert.notEqual(first.services[name], second.services[name], `${name} must be mount-scoped`);
  }

  const calls = [];
  first.services.uiActions.register(SETTINGS_CHANGED_ACTION, () => calls.push("first"));
  second.services.uiActions.register(SETTINGS_CHANGED_ACTION, () => calls.push("second"));
  first.services.settingsPreferences.setThinkingVisible(false);
  second.services.settingsPreferences.setThinkingVisible(false);
  assert.deepEqual(calls, ["first", "second"]);

  const pendingDialog = first.services.dialogs.openText("Prompt");
  const pendingPicker = first.services.checkpointModelPicker.open();
  first.teardown();
  first.teardown();

  assert.equal(await pendingDialog, null);
  assert.deepEqual(await pendingPicker, { cancelled: true });
  first.services.settingsPreferences.setThinkingVisible(true);
  assert.equal(firstBrowser.values.get("pi_show_thinking"), "0");
  assert.equal(first.services.uiActions.invoke(SETTINGS_CHANGED_ACTION), undefined);

  second.services.settingsPreferences.setThinkingVisible(true);
  assert.deepEqual(calls, ["first", "second", "second"]);
  assert.equal(secondBrowser.values.get("pi_show_thinking"), "1");
  second.teardown();
});
