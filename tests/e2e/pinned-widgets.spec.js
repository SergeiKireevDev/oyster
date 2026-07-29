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

async function touchDragTo(page, source, target) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("touch drag source or target is not visible");
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
  await page.waitForTimeout(350);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...to, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
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

  // Exercise the browser's real file chooser and raw upload request rather
  // than seeding every explorer file through the JSON save API.
  const uploadName = `e2e-upload-${Date.now()}.json`;
  const uploadContent = Buffer.alloc(9 * 1024 * 1024 + 17, 0x78);
  const uploadResponses = [];
  const collectUploadResponse = (response) => {
    const url = new URL(response.url());
    if (response.request().method() === "POST"
      && url.pathname === "/file-upload"
      && url.searchParams.get("name") === uploadName) uploadResponses.push(response);
  };
  page.on("response", collectUploadResponse);
  const chooser = page.waitForEvent("filechooser");
  await page.locator('#mActions button[title^="upload local files"]').click();
  await (await chooser).setFiles({
    name: uploadName,
    // This MIME type previously made Hub buffer an 8 MiB chunk as JSON and
    // reject it against the smaller JSON request limit with HTTP 413.
    mimeType: "application/json",
    buffer: uploadContent,
  });
  await expect(page.locator(".toast", { hasText: `uploaded 1 file to /workspace` })).toBeVisible();
  await expect.poll(() => uploadResponses.length).toBe(19);
  page.off("response", collectUploadResponse);
  expect(uploadResponses).toHaveLength(19);
  expect(uploadResponses.every((response) => response.status() === 200)).toBe(true);
  await expect(page.locator("#mBody")).toContainText(uploadName);
  expect(Number(dexec(`stat -c %s /workspace/${uploadName}`))).toBe(uploadContent.length);

  await page.locator("#mActions .chip", { hasText: "Close" }).click();
  await expectWidgetSidebarOpen(page, mobile);

  // The custom prompt stays focused on creating a new live interface.
  await page.click("#hublotAdd");
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await expect(page.locator("#mTitle")).toHaveText("New live interface widget");
  await expect(page.getByText("New live interface widget", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /File explorer/ })).toHaveCount(0);
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

  const groupName = `${mobile ? "Mobile" : "Dragged"} group ${Date.now()}`;
  const createdGroup = await api("POST", "/pinned-widget-groups", { name: groupName, sessionId, scope: "session" });
  expect(createdGroup.status).toBe(201);

  const group = page.locator("#hublots .pinned-widget-group-cell", { hasText: groupName });
  await expect(group).toBeVisible();
  await expect(group.locator(".pinned-widget-count")).toHaveText("0");

  if (mobile) {
    // Long-press the widget icon and drag it onto the group using real browser
    // touch input; mobile browsers do not synthesize native HTML drop events.
    await touchDragTo(page, liveWidget.locator(".pinned-widget-icon"), group);
    await expectWidgetSidebarOpen(page, true);
  } else {
    // Exercise the desktop HTML drag-and-drop path rather than moving through
    // the management menu. The drop must persist before the group is opened.
    await liveWidget.dragTo(group);
  }

  await expect(group.locator(".pinned-widget-count")).toHaveText("1");
  await group.locator(".pinned-widget-tile").click();
  await expect(page.locator("#hublots .pinned-widget-folder-title")).toHaveText(groupName);
  await expect(liveWidget).toBeVisible();

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
  test("drag a live-interface widget into a group", async ({ page }) => {
    await body(page);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  test("touch-drag a widget into a group while keeping the sidebar open", async ({ page }) => {
    await body(page, { mobile: true });
  });
});
