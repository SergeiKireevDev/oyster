import { test, expect } from "@playwright/test";
import { api, currentSessionId, dexec, login, sendPrompt, waitFor } from "./lib/harness.js";
import { ensureContainer, replaceContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer({ sqlite: true }); });
test.afterEach(() => { teardownContainer(); });

test("SQLite conversation survives container replacement on the agent volume", async ({ page }) => {
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

  await replaceContainer();
  await login(page);

  const after = await api("GET", "/sessions?dir=/workspace");
  expect(after.status).toBe(200);
  expect(after.json.sessions.some((session) => session.id === sessionId && session.sessionRef?.backend === "sqlite")).toBe(true);

  await page.click("#menuBtn");
  await page.click('#menu button[data-action="sessions"]');
  await expect(page.locator("#mTitle")).toHaveText("Sessions");
  const row = page.locator(".m-option", { hasText: token });
  await expect(row).toBeVisible({ timeout: 15000 });

  const search = page.locator("#mBody .search-row input[type=text]");
  await search.fill(token);
  await search.press("Enter");
  const hit = page.locator(".search-hit", { hasText: token }).first();
  await expect(hit).toBeVisible({ timeout: 15000 });
  await hit.click();
  await expect(page.locator(".msg.assistant", { hasText: token }).last()).toBeVisible({ timeout: 15000 });
  await waitFor(async () => (await currentSessionId(page)) === sessionId, {
    timeout: 15000,
    label: "resumed SQLite session after search hit",
  });
  expect(dexec("find /root/.pi/agent -type f -name '*.jsonl' -print")).toBe("");
});
