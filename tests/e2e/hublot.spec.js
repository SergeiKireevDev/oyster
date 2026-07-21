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

function installFakeCloudflared() {
  // Make the tunnel layer deterministic: this spec tests pi-lot-ui's hublot UI,
  // session binding, background agent, and close flow. Relying on Cloudflare's
  // public quick-tunnel service makes the suite flaky/rate-limit prone.
  dexec(`bin=$(command -v cloudflared); cat > "$bin" <<'EOF'
#!/usr/bin/env bash
echo "https://e2e-\${RANDOM}-fake.trycloudflare.com" >&2
while true; do sleep 3600; done
EOF
chmod +x "$bin"`);
}

async function body(page, { mobile = false } = {}) {
  const marker = `e2e-btn-${Date.now()}`;
  const brief =
    `Serve a minimal static web page on the local port. Its HTML body must contain ` +
    `exactly one <button> element with the visible text "Click me" and a title tag "${marker}". ` +
    `No frameworks — a plain HTML response is fine. Keep the server running detached.`;

  await login(page);
  installFakeCloudflared();

  // the hublot binds to the session the UI currently shows; capture its id
  // (don't open a new session here — the id only settles after the new
  // runner's get_state lands, which would race this read)
  const sessionId = await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "a session id",
  });

  // open the Hublots modal via the sidebar "+" and fill the New hublot form.
  // On mobile the sidebar is a slide-over drawer toggled by the header chip.
  if (mobile) {
    await page.click("#hublotChip");
    await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  }
  await page.click("#hublotAdd");
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  const desc = page.locator('#mBody textarea');
  await desc.fill(brief);
  await page.getByRole("button", { name: "Open hublot" }).click();

  // the tunnel record should appear, bound to this session, once cloudflared
  // reports its public URL (usually seconds). The server truncates the label
  // to 200 chars, so match on the unique marker (which is near the start of
  // the brief) rather than the full text.
  const tunnel = await waitFor(
    async () => {
      const { json } = await api("GET", "/tunnels");
      return (json.tunnels ?? []).find((t) => (t.label ?? "").includes(marker));
    },
    { timeout: 60000, interval: 1000, label: "hublot tunnel to register" }
  );
  expect(tunnel.sessionId).toEqual(sessionId);
  expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  expect(tunnel.port).toBeGreaterThan(0);

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
