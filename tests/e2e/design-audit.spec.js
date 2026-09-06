import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

async function expectFocusInside(page, selector) {
  expect(await page.evaluate((selector) => !!document.activeElement.closest(selector), selector)).toBe(true);
}
async function openSettings(page) {
  await page.locator("#menuBtn").click();
  await page.locator('#menu [data-action="settings"]').click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
}
async function expectContrast(page) {
  await page.addScriptTag({ path: axePath });
  // Measure the selected theme/drawer state, not a halfway-interpolated CSS
  // transition. Do not wait on indefinite agent/status spinner animations.
  await page.evaluate(async () => {
    const transitions = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(transitions.map((animation) => animation.finished.catch(() => {})));
  });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  });
  expect(violations).toEqual([]);
}

test("authentication traps focus and never reveals the workspace on Escape", async ({ page }) => {
  await page.goto(process.env.OYSTER_URL);
  await expect(page.locator("#gate.open")).toBeVisible();
  await page.locator("#gateInput").focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    await expectFocusInside(page, "#gate");
  }
  await expect(page.locator("#main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("#gate.open")).toBeVisible();
  await page.locator("#gateInput").fill("invalid-staging-token");
  await page.locator("#gateBtn").click();
  await expect(page.getByRole("alert")).toContainText("Authentication failed");
  await page.keyboard.press("Tab");
  await expectFocusInside(page, "#gate");
  await expectContrast(page);
});

test("mobile navigation works without gestures and nested dialogs restore drawer focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const navigation = page.getByRole("navigation", { name: "Workspace navigation" });
  const sessions = navigation.getByRole("button", { name: "Sessions", exact: true });
  await sessions.click();
  await expect(page.getByRole("dialog", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.locator("#chatcol")).toHaveAttribute("inert", "");
  for (let i = 0; i < 16; i++) { await page.keyboard.press("Tab"); await expectFocusInside(page, "#sessions"); }
  await page.locator("#newSessionFolder").click();
  const folder = page.getByRole("dialog", { name: "New session in folder", exact: true });
  await expect(folder).toBeVisible();
  for (let i = 0; i < 10; i++) { await page.keyboard.press("Tab"); await expectFocusInside(page, "#modal"); }
  await page.keyboard.press("Escape");
  await expect(folder).toBeHidden();
  await expect(page.locator("#newSessionFolder")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sessions")).toBeHidden();
  await expect(sessions).toBeFocused();
  await navigation.getByRole("button", { name: "Widgets", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pinned widgets and routines" })).toBeVisible();
  await page.getByRole("button", { name: "Close widgets", exact: true }).click();
  await expect(page.locator("#hublots")).toBeHidden();
  await expect(navigation.getByRole("button", { name: "Widgets", exact: true })).toBeFocused();
  await sessions.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("#chatcol")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#sessions")).not.toHaveAttribute("role", "dialog");
  await expect(page.locator("#hublots")).toBeVisible();
});

test("intermediate viewports preserve a usable composer and progressively collapse rails", async ({ page }) => {
  await login(page);
  for (const width of [1440, 1280, 1201, 1200, 1080, 1024, 961, 960, 900, 820, 768, 761]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator("#input").evaluate((input) => ({ width: input.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth }));
    expect(layout.width, `input at viewport ${width}`).toBeGreaterThanOrEqual(240);
    expect(layout.overflow, `document at viewport ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator("#sessions")).toBeVisible();
  await expect(page.locator("#hublots")).toBeHidden();
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Widgets" }).click();
  await expect(page.getByRole("dialog", { name: "Pinned widgets and routines" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#input")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  const controls = await page.locator("#carouselIndicator button:visible, #menuBtn").evaluateAll((buttons) => buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
  for (const control of controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
});

test("empty conversation explains context and drafts starters without sending or replacing a draft", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toBeVisible();
  await expect(page.locator(".empty-conversation")).toContainText("/workspace");
  await expect(page.locator("#sessions .session-sidebar-placeholder")).toHaveCount(0);
  await page.locator("#input").fill("Keep this draft.");
  await page.getByRole("button", { name: "Review recent changes" }).click();
  await expect(page.locator("#input")).toHaveValue(/Keep this draft\.[\s\S]*Review the recent changes/);
  await expect(page.locator("#input")).toBeFocused();
  await expect(page.locator(".msg.assistant")).toHaveCount(0);
  await page.locator("#sendBtn").click();
  await expect(page.locator(".msg.assistant")).toBeVisible();
  await expect(page.locator(".empty-conversation")).toHaveCount(0);
});

test("both themes retain contrast and Settings owns its actual grid layout", async ({ page }) => {
  await login(page);
  await expectContrast(page);
  await openSettings(page);
  await expect(page.locator(".settings-option").first()).toHaveCSS("display", "grid");
  await expectContrast(page);
  await page.getByRole("checkbox", { name: "Light mode", exact: true }).check();
  await expectContrast(page);
  await page.keyboard.press("Escape");
  await expectContrast(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Sessions" }).click();
  await expectContrast(page);
});

test("compact navigation does not push notification toasts over the composer", async ({ page }) => {
  await login(page);
  await page.locator("#newSessionHere").click();
  await page.setViewportSize({ width: 390, height: 844 });
  const toast = page.locator(".toast", { hasText: "new pi session" });
  await expect(toast).toBeVisible();
  const toastBox = await toast.boundingBox();
  const composerBox = await page.locator("#composer .inner").boundingBox();
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(composerBox.y);
});

test("widget scope is separate from public exposure at the initiating action", async ({ page }) => {
  await login(page);
  await expect(page.locator("#hublots")).toContainText("Across sessions");
  await expect(page.locator("#hublots .pinned-widget-access").first()).toHaveText("Private");
  await page.getByRole("button", { name: "Create public live interface…", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New live interface widget" })).toContainText("public, temporary URL");
});
