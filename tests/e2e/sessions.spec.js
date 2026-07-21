// Session-management e2e scenarios — driven entirely through the UI against
// the self-contained mock-LLM container:
//   A. start sessions + stop a session's background process
//   B. switch between sessions (and confirm the transcript follows)
//   C. search across sessions and jump to a hit
//   D. use a ":" prompt command (command palette)
//
// Distinct sessions are created by sending the mock a
// "Reply with exactly the word <TOKEN>" prompt — the mock echoes the token and
// the UI auto-titles the session after its first message, giving each row a
// stable, searchable handle.

import { test, expect } from "@playwright/test";
import { login, sendPrompt, waitFor, api } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

// Per-test container lifecycle — see checkpoint-rollback.spec.js
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

// The mock container persists sessions in /workspace across runs, and other
// specs also send "Reply with exactly the word X" prompts — so every session
// tag is made unique per run (the UI auto-titles a session after its first
// message, so a unique token => a unique, matchable row).
const RUN = Date.now();
const tag = (base) => `${base}-${RUN}`;

async function newSession(page) {
  await page.click("#menuBtn");
  await page.click('#menu button[data-action="newSession"]');
  // the toast confirms the freshly spawned runner took over as current
  await expect(page.locator(".toast", { hasText: "new session" })).toBeVisible({ timeout: 10000 });
}

async function openSessions(page) {
  await page.click("#menuBtn");
  await page.click('#menu button[data-action="sessions"]');
  await expect(page.locator("#mTitle")).toHaveText("Sessions");
}

// A session row in the picker that is titled/named after `token`.
function rowFor(page, token) {
  return page.locator(".m-option", { hasText: token });
}

test.describe.serial("session management", () => {
  test("start sessions and stop a session's background process", async ({ page }) => {
    await login(page);

    // two fresh sessions, each tagged with a unique token
    const A = tag("ALPHA");
    const B = tag("BETA");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);

    // S2 (B) is now current
    await expect(page.locator(".msg.assistant", { hasText: B }).last()).toBeVisible();

    await openSessions(page);
    // both rows are present and active (each gets a ■ stop control)
    const alpha = rowFor(page, A);
    const beta = rowFor(page, B);
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(alpha.locator(".s-stop")).toBeVisible();
    await expect(beta.locator(".s-stop")).toBeVisible();

    // stop ALPHA's background process
    await alpha.locator(".s-stop").click();
    await expect(page.locator(".toast", { hasText: /process stopped/ })).toBeVisible({ timeout: 10000 });

    // the stop control for ALPHA is now hidden (session went inactive); BETA's
    // remains visible — proving the kill was scoped to that one runner
    await expect(alpha.locator(".s-stop")).toBeHidden();
    await expect(beta.locator(".s-stop")).toBeVisible();

    // confirm via the server that ALPHA's runner process is gone while BETA
    // lives. (The mock doesn't persist the auto-title as a session name, so key
    // the session by its first-message preview instead, joining sessions <-path-
    // sessionFile-> runners.)
    const byPath = async () => {
      const [{ json: ss }, { json: rs }] = await Promise.all([api("GET", "/sessions?dir=/workspace"), api("GET", "/runners")]);
      const sessions = (ss.sessions ?? []).map((s) => ({
        ...s,
        runner: (rs.runners ?? []).find((r) => r.sessionFile === s.path),
      }));
      return {
        alpha: sessions.find((s) => (s.preview ?? "").includes(A)),
        beta: sessions.find((s) => (s.preview ?? "").includes(B)),
      };
    };
    await waitFor(
      async () => {
        const { alpha, beta } = await byPath();
        return alpha && beta && !alpha.runner?.alive && beta.runner?.alive;
      },
      { timeout: 15000, label: "ALPHA stopped, BETA still running" }
    );
  });

  test("switch between sessions — transcript follows the selection", async ({ page }) => {
    await login(page);

    const G = tag("GAMMA");
    const D = tag("DELTA");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${G}.`);
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${D}.`);

    // currently in DELTA
    await expect(page.locator(".msg.assistant", { hasText: D }).last()).toBeVisible();

    // switch back to GAMMA via the picker
    await openSessions(page);
    await rowFor(page, G).click();
    await expect(page.locator(".toast", { hasText: /switched to/ })).toBeVisible({ timeout: 10000 });

    // the transcript reloads to GAMMA's content (and DELTA's is gone)
    await expect(page.locator(".msg.assistant", { hasText: G }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: D })).toHaveCount(0);

    // and the reverse works too
    await openSessions(page);
    await rowFor(page, D).click();
    await expect(page.locator(".msg.assistant", { hasText: D }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: G })).toHaveCount(0);
  });

  test("search across sessions and jump to a hit", async ({ page }) => {
    await login(page);

    // a session whose transcript holds a token unique to this run
    const NEEDLE = tag("XYZZYKITE");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${NEEDLE}.`);

    await openSessions(page);
    const searchBox = page.locator("#mBody .search-row input[type=text]");
    await expect(searchBox).toBeVisible();
    await searchBox.fill(NEEDLE);
    await searchBox.press("Enter");

    // our needle surfaces as a highlighted hit (it matches the user message
    // and the assistant's echoed reply, hence 2 hits) in exactly one session card
    await expect(page.locator(".m-path", { hasText: /hits in/i })).toBeVisible({ timeout: 15000 });
    const hit = page.locator(".search-hit").filter({ hasText: NEEDLE }).first();
    await expect(hit).toBeVisible();
    // the matched token is highlighted (one <mark> per shown snippet — assert the
    // first one carries the needle)
    await expect(hit.locator("mark").first()).toHaveText(NEEDLE);

    // clicking the hit switches to that session and flashes the matching message
    await hit.click();
    await waitFor(
      () => page.locator(".msg").filter({ hasText: NEEDLE }).count().then((c) => c > 0),
      { timeout: 15000, label: "needle visible in transcript after jumping to the hit" }
    );
  });

  test("use a ':' prompt command", async ({ page }) => {
    await login(page);

    // type ":" in the composer to open the command palette
    await page.fill("#input", ":file");
    const palette = page.locator("#cmdPalette");
    await expect(palette).toHaveClass(/open/);
    await expect(palette.locator(".cmd-row", { hasText: "file explorer" })).toBeVisible();

    // the active command can be run with Enter — it opens the file picker modal
    await page.keyboard.press("Enter");
    // palette closes and the app route overlay opens to pick a file
    await expect(palette).not.toHaveClass(/open/);
    await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"), null, {
      timeout: 10000,
    });
    // the file picker lists the workspace contents
    await expect(page.locator("#modal", { hasText: "file" })).toBeVisible();
  });
});
