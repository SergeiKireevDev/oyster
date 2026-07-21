import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createAppSettings } from "../server/persistence/appSettings.mjs";
import { createStableEphemeralState, STABLE_STATE_INVENTORY } from "../server/persistence/stateInventory.mjs";
import { RUNNER_EPHEMERAL_FIELDS, RUNNER_MANAGER_EPHEMERAL_FIELDS } from "../server/runners.mjs";

const REQUIRED_EPHEMERAL = [
  "reloadCount", "sseClients", "authFails", "hublotProcessHandles",
  "runnerWatchdogTimer", "runnerReaperTimer", "hublotSupervisor",
];

test("reload, connection, throttle, and timer state is explicitly ephemeral and restart-local", () => {
  for (const field of REQUIRED_EPHEMERAL) {
    assert.equal(STABLE_STATE_INVENTORY[field].classification, "ephemeral", `${field} must remain explicitly ephemeral`);
    assert.equal(STABLE_STATE_INVENTORY[field].repository, null);
  }
  const first = createStableEphemeralState();
  first.reloadCount = 12;
  first.sseClients.add({ response: true });
  first.authFails.set("192.0.2.1", [Date.now()]);
  first.hublotProcessHandles.set("process", { pid: 42 });

  const restarted = createStableEphemeralState();
  assert.equal(restarted.reloadCount, 0);
  assert.equal(restarted.sseClients.size, 0);
  assert.equal(restarted.authFails.size, 0);
  assert.equal(restarted.hublotProcessHandles.size, 0);
  assert.notEqual(restarted.sseClients, first.sseClients);
  assert.notEqual(restarted.authFails, first.authFails);
});

test("ephemeral server and runner fields never enter app_settings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-ephemeral-settings-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const settings = createAppSettings({ repository: store.repositories.settings, startupWorkdir: "/workspace" });
  settings.setCurrentWorkdir("/persisted");
  settings.setDefaultRunnerId("r-12345678");

  const persistedKeys = new Set(store.repositories.settings.list().map((row) => row.key));
  for (const field of [
    ...REQUIRED_EPHEMERAL,
    ...RUNNER_EPHEMERAL_FIELDS,
    ...RUNNER_MANAGER_EPHEMERAL_FIELDS,
  ]) assert.equal(persistedKeys.has(field), false, `${field} leaked into app_settings`);
  assert.deepEqual([...persistedKeys].sort(), ["current_workdir", "default_runner_id"]);
});
