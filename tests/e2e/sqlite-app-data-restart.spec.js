import { test, expect } from "@playwright/test";
import { api, login } from "./lib/harness.js";
import { ensureContainer, restartServerProcess, teardownContainer } from "./lib/reset.js";

const ROUTINE_SCRIPT = `#!/bin/bash
set -eu
case "\${1:-run}" in
  run) echo "::progress 100 restored" ;;
  teardown) echo "restored routine cleaned" ;;
esac
`;

test.beforeEach(async () => { await ensureContainer({ sqlite: true }); });
test.afterEach(() => { teardownContainer(); });

test("hublots and routines are restored from app SQLite after server/server.mjs restarts", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const routineName = `sqlite-restart-${suffix}.sh`;
  const hublotLabel = `sqlite-restart-hublot-${suffix}`;

  // Seed only through public APIs. The browser is intentionally not loaded
  // until after server/server.mjs has exited and a new process has started, so these
  // UI assertions cannot be satisfied by pre-restart browser or server state.
  const routine = await api("POST", "/routines", {
    action: "create",
    name: routineName,
    script: ROUTINE_SCRIPT,
  });
  expect(routine.status).toBe(201);

  const hublot = await api("POST", "/tunnels", {
    label: hublotLabel,
    brief: `Create a minimal static page titled "${hublotLabel}" and keep its local server running.`,
  });
  expect(hublot.status).toBe(201);
  expect(hublot.json.agent).toBe(true);
  expect(hublot.json.tunnel?.id).toBeTruthy();
  expect(hublot.json.tunnel?.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);

  await restartServerProcess();
  await login(page);

  await expect(page.locator("#routineList .routine-block", { hasText: routineName })).toBeVisible({
    timeout: 30000,
  });
  const restoredHublot = page.locator("#hublotList .hublot-block:not(.builtin)", { hasText: hublotLabel });
  await expect(restoredHublot).toBeVisible({ timeout: 30000 });
  // The iframe can only be populated from the persisted hublots.public_url
  // value (or the replacement URL persisted by startup reconciliation).
  await expect(restoredHublot.locator("iframe")).toHaveAttribute(
    "src",
    /^https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  );
});
