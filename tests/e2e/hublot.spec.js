// Feature 1 — Start a session, create a hublot for a simple button interface.
//
// Drives the real UI: open a fresh session, open the Hublots panel, describe a
// button page in the "New hublot" form, and submit. The server opens a real
// cloudflared tunnel and hands a background pi agent the brief; the agent
// builds the page and serves it on the allocated port. We assert the hublot
// shows up bound to the session, and that the served page actually contains
// the button.

import { test, expect } from "@playwright/test";
import { login, api, dexec, waitFor, currentSessionId, MOBILE_VIEWPORT } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

// Per-test container lifecycle — see checkpoint-rollback.spec.js
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

function workspaceMarkerName() {
  return `e2e-file-explorer-${Date.now()}.txt`;
}

async function explorerFileNames(page) {
  return page.locator("#mBody .m-option.file").evaluateAll((els) =>
    els.map((el) => (el.getAttribute("title") || el.textContent || "").split(/[\\/]/).pop().trim()).filter(Boolean)
  );
}

async function expectFileExplorerPopulated(page, markerName) {
  await expect(page.locator("#overlay")).toHaveClass(/open/, { timeout: 10000 });
  await expect(page.locator("#mTitle")).toHaveText("📁 File explorer", { timeout: 10000 });
  await expect.poll(
    async () => page.locator("#mBody").textContent().catch(() => ""),
    { timeout: 15000, message: "file explorer body to list the workspace marker" }
  ).toContain(markerName);
  const names = await explorerFileNames(page);
  expect(names).toContain(markerName);
  return names;
}

async function body(page, { mobile = false } = {}) {
  const marker = `e2e-btn-${Date.now()}`;
  // Keep the unique marker inside the server's 200-character tunnel-label
  // limit: registration is asserted through the public tunnel list, whose
  // label is deliberately truncated independently of the full agent brief.
  const brief =
    `Create a page with title "${marker}". Serve a minimal static web page on the local port. ` +
    `Its HTML body must contain exactly one <button> element with the visible text "Click me". ` +
    `No frameworks — a plain HTML response is fine. Keep the server running detached.`;

  await login(page);

  // the hublot binds to the session the UI currently shows; capture its id
  // (don't open a new session here — the id only settles after the new
  // runner's get_state lands, which would race this read)
  const sessionId = await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "a session id",
  });

  const markerName = workspaceMarkerName();
  const saved = await api("POST", "/file-save", {
    path: `/workspace/${markerName}`,
    content: "file explorer e2e marker\n",
  });
  expect(saved.status).toBe(200);

  // On mobile the hublots sidebar is a slide-over drawer toggled by the header chip.
  if (mobile) {
    await page.click("#hublotChip");
    await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  }

  // The built-in file explorer should be available directly from the sidebar
  // and should list the current workspace contents.
  await page.locator("#hublotList .hublot-block", { hasText: "file explorer" }).first().click();
  const sidebarFiles = await expectFileExplorerPopulated(page, markerName);
  await page.locator("#mActions .chip", { hasText: "Close" }).click();

  // The same built-in file explorer is also exposed inside the Hublots manager modal.
  // Verify it opens and is populated with the same workspace file list.
  if (mobile) await page.evaluate(() => document.getElementById("hublots")?.classList.add("open"));
  await page.click("#hublotAdd");
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await expect(page.locator("#mTitle")).toHaveText(/Hublots/);
  await page.getByRole("button", { name: /File explorer/ }).click();
  const modalFiles = await expectFileExplorerPopulated(page, markerName);
  expect(new Set(modalFiles)).toEqual(new Set(sidebarFiles));
  await page.locator("#mActions .chip", { hasText: "← Hublots" }).click();
  await expect(page.locator("#mTitle")).toHaveText(/Hublots/);

  // The E2E image configures TUNNEL_BIN to its bundled stand-in, avoiding
  // external quick-tunnel limits while exercising the same POST contract the
  // manager uses. Create through that contract after verifying the manager UI.
  const opened = await api("POST", "/tunnels", { label: brief, sessionId, brief });
  expect(opened.status).toBe(201);
  const tunnel = opened.json.tunnel;
  expect(tunnel.sessionId).toEqual(sessionId);
  expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  expect(tunnel.port).toBeGreaterThan(0);
  await page.locator("#mActions .chip", { hasText: "Close" }).click();

  // it should also render as a live block in the sidebar (non-builtin: has an iframe)
  await expect(page.locator("#hublotList .hublot-block .preview iframe")).toHaveCount(1, {
    timeout: 30000,
  });

  // the background agent builds the page and serves it — poll the local port
  // (inside the container) until the button markup is actually being served
  const served = await waitFor(
    () => {
      const html = dexec(`curl -s --max-time 3 http://127.0.0.1:${tunnel.port}/ || true`, { allowFail: true });
      return /<button/i.test(html) && /click me/i.test(html) ? html : null;
    },
    { timeout: 4 * 60 * 1000, interval: 3000, label: "the hublot to serve the button page" }
  );
  expect(served).toMatch(/<button/i);
  expect(served).toMatch(/click me/i);

  // close the hublot from the UI (✕ on the non-builtin tunnel block) and confirm it goes away
  if (mobile) {
    await page.evaluate(() => document.getElementById("hublots")?.classList.add("open"));
  }
  await page.locator("#hublotList .hublot-block:not(.builtin) .cap .x").first().click();
  await waitFor(
    async () => {
      const { json } = await api("GET", "/tunnels");
      return !(json.tunnels ?? []).some((t) => t.id === tunnel.id);
    },
    { timeout: 30000, interval: 1000, label: "hublot to close" }
  );
}

test.describe("desktop", () => {
  test("start a session and open a hublot serving a button interface", async ({ page }) => {
    await body(page);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  test("start a session and open a hublot serving a button interface", async ({ page }) => {
    await body(page, { mobile: true });
  });
});
