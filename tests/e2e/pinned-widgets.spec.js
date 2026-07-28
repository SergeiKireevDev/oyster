// Pinned Widgets — built-in artifacts, managed live interfaces, and mobile drawer continuity.
//
// Drives the real Docker UI. A managed live-interface widget still uses the
// compatibility /tunnels lifecycle, while its user-facing representation is a
// compact Pinned Widget tile and never an eager iframe.

import { test, expect } from "@playwright/test";
import { login, api, dexec, waitFor, currentSessionId, MOBILE_VIEWPORT, swipe } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

function workspaceMarkerName() {
  return `e2e-pinned-widget-${Date.now()}.txt`;
}

async function explorerFileNames(page) {
  return page.locator("#mBody .m-option.file").evaluateAll((elements) =>
    elements.map((element) => (element.getAttribute("title") || element.textContent || "").split(/[\\/]/).pop().trim()).filter(Boolean)
  );
}

async function expectFileExplorerPopulated(page, markerName) {
  await expect(page.locator("#overlay")).toHaveClass(/open/, { timeout: 10000 });
  await expect(page.locator("#mTitle")).toHaveText("File explorer", { timeout: 10000 });
  await expect.poll(
    async () => page.locator("#mBody").textContent().catch(() => ""),
    { timeout: 15000, message: "file explorer body to list the workspace marker" }
  ).toContain(markerName);
  const names = await explorerFileNames(page);
  expect(names).toContain(markerName);
  return names;
}

async function expectWidgetSidebarOpen(page, mobile) {
  if (mobile) await expect(page.locator("#hublots")).toHaveClass(/open/);
}

async function body(page, { mobile = false } = {}) {
  const marker = `e2e-widget-${Date.now()}`;
  const brief =
    `Create a page with title "${marker}". Serve a minimal static web page on the local port. ` +
    `Its HTML body must contain exactly one <button> element with the visible text "Click me". ` +
    `No frameworks — a plain HTML response is fine. Keep the server running detached.`;

  await login(page);
  const sessionId = await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "a session id",
  });

  const markerName = workspaceMarkerName();
  const saved = await api("POST", "/file-save", {
    path: `/workspace/${markerName}`,
    content: "pinned widget e2e marker\n",
  });
  expect(saved.status).toBe(200);

  if (mobile) {
    await swipe(page, "left");
    await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  }

  // The built-in Files widget opens the native explorer. Closing an operation
  // must return to the still-open widget drawer on mobile.
  const filesWidget = page.locator("#hublots .pinned-widget-cell", { hasText: "Files" }).first();
  await expect(filesWidget).toBeVisible();
  await filesWidget.locator(".pinned-widget-tile").click();
  const sidebarFiles = await expectFileExplorerPopulated(page, markerName);
  await page.locator("#mActions .chip", { hasText: "Close" }).click();
  await expectWidgetSidebarOpen(page, mobile);

  // Widget management and nested file browsing also preserve drawer context.
  await page.click("#hublotAdd");
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await expect(page.locator("#mTitle")).toHaveText("Pin widget");
  await expectWidgetSidebarOpen(page, mobile);
  await page.getByRole("button", { name: /File explorer/ }).click();
  const modalFiles = await expectFileExplorerPopulated(page, markerName);
  expect(new Set(modalFiles)).toEqual(new Set(sidebarFiles));
  await page.locator("#mActions .chip", { hasText: "← Widgets" }).click();
  await expect(page.locator("#mTitle")).toHaveText("Pin widget");
  await expectWidgetSidebarOpen(page, mobile);

  // Create through the compatibility tunnel API. The resulting public service
  // is represented by a status-aware widget tile, not an iframe preview.
  const opened = await api("POST", "/tunnels", { label: brief, sessionId, brief });
  expect(opened.status).toBe(201);
  const tunnel = opened.json.tunnel;
  expect(tunnel.sessionId).toEqual(sessionId);
  expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  expect(tunnel.port).toBeGreaterThan(0);
  await page.locator("#mActions .chip", { hasText: "Close" }).click();
  await expectWidgetSidebarOpen(page, mobile);

  const liveWidget = page.locator("#hublots .pinned-widget-cell", { hasText: marker }).first();
  await expect(liveWidget).toBeVisible({ timeout: 30000 });
  await expect(liveWidget.locator(".pinned-widget-icon.kind-live_interface")).toBeVisible();
  await expect(liveWidget.locator("iframe")).toHaveCount(0);

  const served = await waitFor(
    () => {
      const html = dexec(`curl -s --max-time 3 http://127.0.0.1:${tunnel.port}/ || true`, { allowFail: true });
      return /<button/i.test(html) && /click me/i.test(html) ? html : null;
    },
    { timeout: 4 * 60 * 1000, interval: 3000, label: "the live-interface widget to serve the button page" }
  );
  expect(served).toMatch(/<button/i);
  expect(served).toMatch(/click me/i);

  if (mobile) {
    // Touch users should not have to rely on HTML drag-and-drop. Create a group,
    // move the widget through its management menu, then open the group.
    const groupName = `Mobile group ${Date.now()}`;
    await page.locator('#hublots button[title="Create a widget group"]').click();
    await expect(page.locator("#mTitle")).toHaveText("New widget group");
    await page.locator("#mBody input[type=text]").fill(groupName);
    await page.locator("#mActions .btn", { hasText: "OK" }).click();
    await expectWidgetSidebarOpen(page, true);

    const group = page.locator("#hublots .pinned-widget-group-cell", { hasText: groupName });
    await expect(group).toBeVisible();
    await expect(group.locator(".pinned-widget-count")).toHaveText("0");

    await liveWidget.locator(".pinned-widget-menu").click();
    await expect(page.locator("#mTitle")).toContainText("Manage");
    await page.locator("#mBody .m-option", { hasText: `Move to ${groupName}` }).click();
    await expectWidgetSidebarOpen(page, true);
    await expect(group.locator(".pinned-widget-count")).toHaveText("1");
    await group.locator(".pinned-widget-tile").click();
    await expect(page.locator("#hublots .pinned-widget-folder-title")).toHaveText(groupName);
    await expect(liveWidget).toBeVisible();
  }

  // Manage the widget through its three-dot menu. Closing the live interface
  // is separate from unpinning and must not dismiss the mobile widget drawer.
  await liveWidget.locator(".pinned-widget-menu").click();
  await expect(page.locator("#mTitle")).toContainText("Manage");
  await page.locator("#mBody .m-option", { hasText: "Close live interface" }).click();
  await expectWidgetSidebarOpen(page, mobile);
  await waitFor(
    async () => {
      const { json } = await api("GET", "/tunnels");
      return !(json.tunnels ?? []).some((item) => item.id === tunnel.id);
    },
    { timeout: 30000, interval: 1000, label: "live interface to close" }
  );
  await expect(liveWidget).toHaveClass(/unavailable/);
}

test.describe("desktop", () => {
  test("pin artifacts and manage a live-interface widget", async ({ page }) => {
    await body(page);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  test("group a widget while keeping the sidebar open throughout mobile operations", async ({ page }) => {
    await body(page, { mobile: true });
  });
});
