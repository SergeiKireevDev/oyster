import { test, expect } from "@playwright/test";
import { api, login, dexec } from "./lib/harness.js";
import { ensureContainer, restartServerProcess, teardownContainer } from "./lib/reset.js";

const ROUTINE_SCRIPT = `#!/bin/bash
set -eu
case "\${1:-run}" in
  run) echo "::progress 100 restored" ;;
  teardown) echo "restored routine cleaned" ;;
esac
`;

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

test("routines and pinned live-interface records persist while ephemeral tunnel URLs retire", async ({ page }) => {
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

  dexec(`nohup node -e 'require("http").createServer((_,res)=>res.end("preview")).listen(46101,"127.0.0.1")' >/tmp/restart-preview.log 2>&1 &`);
  const hublot = await api("POST", "/tunnels", {
    label: hublotLabel,
    port: 46101,
  });
  expect(hublot.status).toBe(201);
  expect(hublot.json.agent).toBeUndefined();
  expect(hublot.json.tunnel?.id).toBeTruthy();
  expect(hublot.json.tunnel?.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);

  await restartServerProcess();
  await login(page);

  await expect(page.locator("#routineList .routine-block", { hasText: routineName })).toBeVisible({
    timeout: 30000,
  });
  const retiredWidget = page.locator("#hublots .pinned-widget-cell", { hasText: hublotLabel });
  await expect(retiredWidget).toBeVisible();
  await expect(retiredWidget).toHaveClass(/unavailable/);
  await expect(retiredWidget.locator("iframe")).toHaveCount(0);

  const reopened = await api("POST", "/tunnels", {
    label: `${hublotLabel}-fresh`,
    port: 46101,
  });
  expect(reopened.status).toBe(201);
  expect(reopened.json.tunnel?.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  expect(reopened.json.tunnel?.url).not.toBe(hublot.json.tunnel.url);
});
