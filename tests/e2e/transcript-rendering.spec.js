import { test, expect } from "@playwright/test";
import { currentSessionId, login, sendPrompt, swipe, waitFor } from "./lib/harness.js";
import { ensureContainer, replaceContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer({ sqlite: true }); });
test.afterEach(() => { teardownContainer(); });

test("agent display math is rendered by KaTeX", async ({ page }) => {
  await login(page);
  await sendPrompt(page, "E2E_MAXWELL_KATEX: return the Maxwell equation fixture.");

  const answer = page.locator(".msg.assistant").last();
  await expect(answer.locator(".math-block .katex-display")).toBeVisible();
  await expect(answer.locator(".katex-mathml annotation")).toContainText(String.raw`\nabla \times \mathbf{B}`);
  await expect(answer.locator(".katex-error")).toHaveCount(0);
});

test("session search opens the specific matching user message", async ({ page }) => {
  await login(page);
  const marker = `SEARCH-NAV-${Date.now()}`;
  const first = `first user message with ${marker}`;
  const second = `second user message with ${marker}`;
  await sendPrompt(page, first);
  await sendPrompt(page, second);
  for (let index = 0; index < 12; index += 1) {
    await sendPrompt(page, `additional user result ${index} with ${marker}`);
  }

  const search = page.locator("#sessions .session-sidebar-search");
  await search.fill(marker);
  const resultGroup = page.locator("#sessions .session-sidebar-hit-group");
  await expect(resultGroup).toHaveCount(1);
  await expect(resultGroup.locator(":scope > .session-sidebar-folder")).toBeVisible();
  await expect(resultGroup.locator(":scope > .session-sidebar-folder")).toContainText("/workspace");
  await expect(resultGroup.locator(".session-sidebar-hit")).toHaveCount(14);
  const secondHit = resultGroup.locator(".session-sidebar-hit", { hasText: second });
  await expect(secondHit).toBeVisible();
  await expect(secondHit).toHaveCSS("height", "72px");
  await expect(secondHit.locator(".s-role")).toHaveText("you");
  await expect(secondHit.locator("mark")).toHaveText(marker);

  await secondHit.click();
  await expect(page.locator('[data-role="user"]', { hasText: second })).toHaveClass(/msg-flash/);
  await expect(page.locator('[data-role="user"]', { hasText: first })).not.toHaveClass(/msg-flash/);

  await page.setViewportSize({ width: 390, height: 844 });
  await swipe(page, "right");
  await expect(resultGroup.locator(":scope > .session-sidebar-folder")).toBeVisible();
  await expect(secondHit).toHaveCSS("height", "72px");
  const scrollState = await page.locator("#sessions .session-sidebar-list").evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(scrollState.overflowY).toBe("auto");
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
});

test("historical SQLite tool results do not return as waiting after reload", async ({ page }) => {
  await login(page);
  await sendPrompt(page, "E2E_PERSISTED_TOOL: run the deterministic tool fixture.");

  const sessionId = await waitFor(() => currentSessionId(page), {
    timeout: 30000,
    label: "SQLite tool session id",
  });
  const liveTool = page.locator(".block.tool", { hasText: "persisted-tool-result" }).first();
  await expect(liveTool.locator(".status")).toHaveText("✓");

  // Push the tool turn outside the initial 40-message tail. Older chunks are
  // prepended in reverse DOM order, which previously lost their tool result.
  for (let index = 0; index < 22; index += 1) {
    await sendPrompt(page, `SQLite transcript filler ${index}`);
  }

  await replaceContainer({ sqlite: true });
  await login(page);
  await waitFor(async () => (await currentSessionId(page)) === sessionId, {
    timeout: 30000,
    label: "reloaded SQLite tool session",
  });

  const restoredTool = page.locator(".block.tool", { hasText: "persisted-tool-result" }).first();
  await expect(restoredTool).toBeVisible({ timeout: 30000 });
  await expect(restoredTool.locator(".status")).toHaveText("✓");
  await expect(page.locator(".block.tool .status.running")).toHaveCount(0);
  await expect(page.locator(".block.tool .status", { hasText: "⏳" })).toHaveCount(0);
});
