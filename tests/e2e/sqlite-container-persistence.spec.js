import { test, expect } from "@playwright/test";
import { api, currentSessionId, dexec, login, sendPrompt, waitFor } from "./lib/harness.js";
import { ensureContainer, replaceContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer({ sqlite: true }); });
test.afterEach(() => { teardownContainer(); });

test("SQLite conversation survives replacement and an intact JSONL rollback toggle", async ({ page }) => {
  const token = `SQLITE-VOLUME-${Date.now()}`;
  await login(page);
  await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${token}.`);

  const sessionId = await waitFor(() => currentSessionId(page), {
    timeout: 30000,
    label: "persisted SQLite session id",
  });
  const before = await api("GET", "/sessions?dir=/workspace");
  expect(before.status).toBe(200);
  const persisted = before.json.sessions.find((session) => session.id === sessionId);
  expect(persisted).toMatchObject({ id: sessionId, sessionRef: { backend: "sqlite", id: sessionId } });
  expect(persisted.sessionKey).toBeTruthy();
  expect(dexec("find /root/.pi/agent -type f -name '*.jsonl' -print")).toBe("");
  expect(dexec("test -s /root/.pi/agent/sessions.sqlite && echo present")).toBe("present");
  const sqliteHash = dexec("sha256sum /root/.pi/agent/sessions.sqlite | cut -d' ' -f1");

  await replaceContainer();
  await login(page);

  const after = await api("GET", "/sessions?dir=/workspace");
  expect(after.status).toBe(200);
  expect(after.json.sessions.some((session) => session.id === sessionId && session.sessionRef?.backend === "sqlite")).toBe(true);

  await expect(page.locator("#sessions")).toBeVisible();
  const search = page.locator("#sessions .session-sidebar-search");
  await search.fill(token);
  const hit = page.locator("#sessions .session-sidebar-hit", { hasText: token }).first();
  await expect(hit).toBeVisible({ timeout: 15000 });
  await hit.click();
  await expect(page.locator(".msg.assistant", { hasText: token }).last()).toBeVisible({ timeout: 15000 });
  await waitFor(async () => (await currentSessionId(page)) === sessionId, {
    timeout: 15000,
    label: "resumed SQLite session after search hit",
  });
  expect(dexec("find /root/.pi/agent -type f -name '*.jsonl' -print")).toBe("");

  // Toggle the same volume to the explicit release/JSONL rollback image. A
  // JSONL conversation must not rewrite the dormant SQLite database.
  await replaceContainer({ sqlite: false });
  await login(page);
  const jsonlToken = `JSONL-ROLLBACK-${Date.now()}`;
  await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${jsonlToken}.`);
  expect(dexec("sha256sum /root/.pi/agent/sessions.sqlite | cut -d' ' -f1")).toBe(sqliteHash);
  const jsonlManifest = dexec("find /root/.pi/agent -type f -name '*.jsonl' -exec sha256sum {} + | sort");
  expect(jsonlManifest).toContain(".jsonl");

  // Toggle back to SQLite: the original database session and the independent
  // JSONL rollback data must both still be present and readable/intact.
  await replaceContainer({ sqlite: true });
  await login(page);
  const restored = await api("GET", "/sessions?dir=/workspace");
  expect(restored.json.sessions.some((session) => session.id === sessionId)).toBe(true);
  expect(dexec("find /root/.pi/agent -type f -name '*.jsonl' -exec sha256sum {} + | sort")).toBe(jsonlManifest);
});
