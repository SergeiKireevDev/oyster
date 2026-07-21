// Feature: the ⎇ header chip toggles the checkpoints-and-forks sidebar, which
// shows the session family (root, checkpoints, forked children). This test
// drives that entire surface — making checkpoints, verifying the sidebar renders
// them, rolling back (creates a fork), and verifying the sidebar shows the fork
// nested under its birth checkpoint.
//
// Run twice: desktop (wide — click the chip to toggle the docked sidebar) and
// mobile (narrow — the chip opens the slide-over drawer via the swipe carousel,
// and swiping right steps the carousel back to close it). Each test gets its
// OWN container (via beforeEach/afterEach in the harness), so they never share
// workspace state.

import { test, expect } from "@playwright/test";
import {
  login, dexec, sendPrompt, waitFor, currentSessionId,
  MOBILE_VIEWPORT, forceNewSession, swipe,
} from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const DIR = "/workspace";
const NOTES = `${DIR}/e2e-notes.txt`;
const headShort = () => dexec(`git -C ${DIR} rev-parse --short HEAD`);

// Per-test container lifecycle: beforeEach starts one if needed, afterEach
// tears it down. Desktop and mobile get independent workspaces.
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

// set up a clean git repo in /workspace — called per test since each test
// gets its own fresh container
async function initWorkspace() {
  dexec(`
    set -e
    rm -rf ${DIR}/.git ${DIR}/e2e-*.txt ${DIR}/e2e-a-*.txt ${DIR}/e2e-b-*.txt
    cd ${DIR}
    git init -q
    git config user.email e2e@example.com
    git config user.name e2e
    git config commit.gpgsign false
    printf 'alpha\\n' > e2e-notes.txt
    git add -A && git commit -q -m 'baseline'
  `);
}

// ---- desktop variant: click the ⎇ chip to toggle the docked sidebar
test.describe("desktop", () => {
  test("open the treebar via the chip, see checkpoints, fork back, see the fork", async ({ page }) => {
    await body(page, { mobile: false });
  });
});

// ---- mobile variant: the chip opens the slide-over drawer; swiping right
// steps the carousel back to close the drawer
test.describe("mobile", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  test("open the treebar via the chip, see checkpoints, fork back, see the fork", async ({ page }) => {
    await body(page, { mobile: true });
  });
});

async function body(page, { mobile }) {
  await login(page);
  await initWorkspace();
  await forceNewSession(page);
  const mainSession = await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "a session id",
  });

  // the treebar starts closed
  await expect(page.locator("#treebar")).not.toHaveClass(/open/);

  // ---- open it via the ⎇ chip and confirm empty state
  await openTreebar(page, mobile);
  await expect(page.locator("#treebar")).toHaveClass(/open/);
  await expect(page.locator("#treeView")).toContainText("no session file yet");
  // always close the drawer before sending prompts — on mobile it covers the
  // composer, and doing it everywhere keeps the test deterministic
  await closeTreebar(page, mobile);

  const H0 = headShort(); // baseline commit

  // ---- message 1 + change -> freeze -> H1
  await sendPrompt(page, "Do not use any tools. Reply with exactly the word ALPHA.");
  dexec(`cd ${DIR} && printf 'beta\\n' >> e2e-notes.txt && printf 'b\\n' > ${DIR}/e2e-a.txt`);
  await freeze(page);
  const H1 = await waitFor(() => (headShort() !== H0 ? headShort() : null), {
    timeout: 30000, label: "first checkpoint commit",
  });

  // Reopen: a fresh load() tests the real render path (the sidebar was opened
  // before any checkpoint existed, so its content was just the empty state).
  await openTreebar(page, mobile);

  // ---- the sidebar shows the session, and after a checkpoint it shows that
  // checkpoint's hash as a .t-ckpt row. Poll — the SSE-driven render is async.
  await expect
    .poll(
      async () => page.locator("#treeView .t-ckpt").count(),
      { timeout: 15000 }
    )
    .toBeGreaterThanOrEqual(1);
  // the root session row exists
  await expect(page.locator("#treeView .t-session")).toHaveCount(1);
  await closeTreebar(page, mobile);

  // ---- message 2 + change -> freeze -> H2
  await sendPrompt(page, "Do not use any tools. Reply with exactly the word GAMMA.");
  dexec(`cd ${DIR} && printf 'gamma\\n' >> e2e-notes.txt && printf 'c\\n' > ${DIR}/e2e-b.txt`);
  await freeze(page);
  const H2 = await waitFor(() => (headShort() !== H1 ? headShort() : null), {
    timeout: 30000, label: "second checkpoint commit",
  });

  // there are now two checkpoint rows — reopen the drawer to see them
  await openTreebar(page, mobile);
  await expect(page.locator("#treebar")).toHaveClass(/open/);
  await expect
    .poll(async () => page.locator("#treeView .t-ckpt").count(), { timeout: 15000 })
    .toBe(2);

  // both checkpoint hashes appear somewhere in the tree
  await expect(page.locator("#treeView")).toContainText(H1.slice(0, 7));
  await expect(page.locator("#treeView")).toContainText(H2.slice(0, 7));

  // ---- roll back to H1 via the SIDEBAR's own checkpoint row (not the chat arrow)
  await expect(page.locator("#treeView .t-ckpt").first()).toBeVisible();
  // click the t-ckpt row that contains H1's hash — opens the rollback modal
  await page.locator("#treeView .t-ckpt", { hasText: H1.slice(0, 7) }).click();
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await page.getByRole("button", { name: /Roll back/ }).click();

  // a forked session opens — its title carries the rollback hash
  await expect.poll(() => currentSessionId(page), { timeout: 30000 }).not.toEqual(mainSession);
  await expect(page.locator("#sessionTitle")).toContainText(H1, { timeout: 15000 });

  // ---- reopen the treebar in the NEW session: it shows the fork nested under
  // its birth checkpoint
  await expect(page.locator("#treebar")).not.toHaveClass(/open/);
  await openTreebar(page, mobile);

  // a fork group (t-forks) now exists under one of the checkpoint rows
  await expect
    .poll(async () => page.locator("#treeView .t-forks").count(), { timeout: 15000 })
    .toBeGreaterThanOrEqual(1);
  // the fork shows the 🌿 marker
  await expect(page.locator("#treeView .t-session .t-name").first()).toBeVisible();

  // ---- close the sidebar via the chip (or swipe) — confirms it is still live
  await closeTreebar(page, mobile);
  await expect(page.locator("#treebar")).not.toHaveClass(/open/);

  // ---- reopen and verify a tap on the fork row switches sessions
  await openTreebar(page, mobile);
  const forkName = await page.locator("#treeView .t-forks .t-session .t-name").first().textContent();
  await page.locator("#treeView .t-forks .t-session").first().click();
  // session title changes to the fork's name
  await expect(page.locator("#sessionTitle")).toHaveText(forkName.trim(), { timeout: 15000 });
}

// open the checkpoints sidebar — on desktop click the chip; on mobile the chip
// opens the slide-over drawer (carousel page 2)
async function openTreebar(page, mobile) {
  await page.click("#treeChip");
  if (mobile) {
    // the chip sets carousel=2 which applyCarousel() renders as #treebar.open
    await expect(page.locator("#treebar")).toHaveClass(/open/);
  }
}

async function closeTreebar(page, mobile) {
  if (mobile) {
    // on mobile the slide-over drawer (z-index 55) covers the header chip, so
    // we can't click it — swipe right TWICE to step the carousel back:
    // page 2 (checkpoints) -> page 1 (hublots) -> page 0 (chat)
    await swipe(page, "right");
    await swipe(page, "right");
    await expect(page.locator("#treebar")).not.toHaveClass(/open/);
  } else {
    await page.click("#treeChip");
  }
}

/** Click the 🧊 checkpoint button and confirm the freeze modal (no summary). */
async function freeze(page) {
  await page.locator(".checkpoint").click();
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  // leave the model selector at its default ("No summary — timestamp message")
  await page.getByRole("button", { name: /Freeze/ }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);
}

test.afterAll(() => {
  dexec(`rm -rf ${DIR}/.git ${DIR}/e2e-*.txt`, { allowFail: true });
});
