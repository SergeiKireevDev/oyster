// Shared helpers for the pi-lot-ui Playwright e2e suite.
//
// The tests target a SELF-CONTAINED pi-lot-ui container on its own port whose
// image bundles a deterministic mock LLM (activated via E2E_MOCK_LLM=1), so
// there are NO credential mounts and no external model calls. They drive the
// product two ways:
//   - through the browser UI (Playwright) — the primary surface under test
//   - through `docker exec` into the container for out-of-band setup and
//     assertions on the container filesystem (git repos, served ports, …)
// and through the HTTP API for a few read-only cross-checks.
//
// Desktop and mobile run as SEPARATE projects with separate containers. The
// per-project PI_UI_URL / PI_UI_TOKEN / PI_UI_CONTAINER are wired by the
// playwright config `use` block — this module just consumes process.env.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, "..", ".e2e-state.json");

export const BASE = process.env.PI_UI_URL ?? "http://localhost:4000";
export const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const DEFAULT_CONTAINER = process.env.PI_UI_CONTAINER ?? "pi-lot-e2e";

function baseUrl() {
  return process.env.PI_UI_URL ?? BASE;
}

function authToken() {
  return process.env.PI_UI_TOKEN ?? TOKEN;
}

/** Name of the container the suite drives (recorded by global-setup). */
export function containerName() {
  if (process.env.PI_UI_CONTAINER) return process.env.PI_UI_CONTAINER;
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, "utf8")).container; } catch {}
  }
  return DEFAULT_CONTAINER;
}

/** Run a bash command INSIDE the container; returns trimmed stdout. */
export function dexec(cmd, { allowFail = false } = {}) {
  try {
    return execFileSync("docker", ["exec", containerName(), "bash", "-lc", cmd], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (allowFail) return String(e.stdout ?? "") + String(e.stderr ?? "");
    throw new Error(`dexec failed: ${cmd}\n${e.stderr ?? e.message}`);
  }
}

/** Stable logical snapshot of the coding-agent SQLite store (ignores WAL/header churn). */
export function sqliteSessionManifest(path = "/root/.pi/agent/sessions.sqlite") {
  const script = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const tables = ["sessions", "session_entries", "session_materialized"];
    const order = { sessions: "id", session_entries: "session_id, entry_seq, id", session_materialized: "session_id" };
    const manifest = {};
    for (const table of tables) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      manifest[table] = exists ? db.prepare("SELECT * FROM " + table + " ORDER BY " + order[table]).all() : [];
    }
    db.close();
    console.log(JSON.stringify(manifest));
  `;
  return execFileSync("docker", ["exec", containerName(), "node", "--input-type=module", "-e", script, path], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** HTTP call against the server with the bearer token. */
export async function api(method, path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns truthy or `timeout` elapses. */
export async function waitFor(fn, { timeout = 30000, interval = 500, label = "condition" } = {}) {
  const start = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - start > timeout) {
      throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    }
    await sleep(interval);
  }
}

/**
 * Load the UI with the token in the fragment and wait until the SSE stream is
 * connected (green dot). Returns once the composer is ready.
 */
export async function login(page) {
  await page.goto(`${baseUrl()}/#token=${authToken()}`);
  await page.waitForSelector("#connDot.ok", { timeout: 30000 });
  await page.waitForSelector("#input", { state: "visible" });
}

/** The current session id the UI is showing. The inline script is a classic
 *  (non-module) script, so its top-level `let state` is a lexical global — NOT
 *  a property of `window` — hence the bare reference. Falls back to the
 *  /s/<id> permalink the UI keeps in the address bar. */
export async function currentSessionId(page) {
  return page.evaluate(() => {
    try {
      if (typeof state !== "undefined" && state?.sessionId) return state.sessionId;
    } catch {}
    const m = location.pathname.match(/^\/s\/([\w.-]+)/);
    return m ? m[1] : null;
  });
}

function assistantCount(page) {
  return page.evaluate(() => document.querySelectorAll(".msg.assistant").length);
}

/** Type a prompt into the composer, send it, and wait for the agent turn to
 *  finish (busy dot clears and at least one assistant message is present).
 *
 *  Wait for the transcript to settle before counting: right after switching
 *  sessions the DOM can still show the previous session's messages until the
 *  SSE reconnect clears them, which would corrupt the "new messages" baseline. */
export async function sendPrompt(page, text, { timeout = 120000 } = {}) {
  if (process.env.E2E_TRACE) console.log("[sendPrompt] settle transcript");
  // settle: the count must stay unchanged across a short window
  let prev = await assistantCount(page);
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    const now = await assistantCount(page);
    if (now === prev) break;
    prev = now;
  }
  const before = await assistantCount(page);
  if (process.env.E2E_TRACE) console.log("[sendPrompt] before=", before, "text=", text.slice(0, 40));
  await page.fill("#input", text);
  await page.click("#sendBtn");
  await waitForCount(page, ".msg.assistant", before + 1, timeout);
  await page.waitForFunction(
    () => {
      const d = document.getElementById("connDot");
      return d && d.classList.contains("ok") && !d.classList.contains("busy");
    },
    { timeout }
  );
}

/** Wait until `selector` matches at least `n` elements. */
export async function waitForCount(page, selector, n, timeout = 60000) {
  await page.waitForFunction(
    ([sel, min]) => document.querySelectorAll(sel).length >= min,
    [selector, n],
    { timeout }
  );
}

// mobile viewport (iPhone 14 — narrow enough to trigger the
// max-width:760px media query where sidebars become slide-over drawers
// and the swipe carousel is active)
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Force a brand-new session for this test: current sessions are reused across
// tests in the same file (one container), so a session that already has
// checkpoints/forks from a prior test would otherwise bleed into this one.
// We use the current workdir's sidebar + button and wait for the session id to change.
export async function forceNewSession(page) {
  const before = await currentSessionId(page);
  const mobile = await page.evaluate(() => innerWidth <= 760);
  if (mobile) {
    for (let attempt = 0; attempt < 3 && !(await page.locator("#sessions").isVisible()); attempt += 1) await swipe(page, "right");
  }
  await page.locator("#sessions .session-sidebar-entry.current")
    .locator("xpath=ancestor::details[1]")
    .locator(":scope > .session-sidebar-cwd-add")
    .click();
  // wait for the id to flip to something new (or null on a truly fresh one)
  await page.waitForFunction(
    (b) => {
      let cur = null;
      try { cur = typeof state !== "undefined" ? state?.sessionId : null; } catch {}
      if (!cur) {
        const m = location.pathname.match(/^\/s\/([\w.-]+)/);
        cur = m ? m[1] : null;
      }
      return cur !== b;
    },
    before,
    { timeout: 30000 }
  );
  // small grace period for the new runner to spawn and the SSE to connect
  await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "new session id after force",
  });
  // clear any slide-over drawer the previous session left open
  await page.evaluate(() => {
    document.getElementById("sessions")?.classList.remove("open");
    document.getElementById("hublots")?.classList.remove("open");
    document.getElementById("treebar")?.classList.remove("open");
  });
}

// horizontal swipe inside the page. Used on mobile where the sidebar is
// toggled by swiping instead of clicking a chip. dir='left' advances the
// carousel (chat -> hublots -> checkpoints); 'right' goes back.
export async function swipe(page, dir, opts = {}) {
  const x0 = opts.x0, y0 = opts.y0, dx = opts.dx || 200, dy = opts.dy || 0;
  const startX = x0 !== undefined ? x0 : MOBILE_VIEWPORT.width * 0.2;
  const endX = startX + (dir === "left" ? -dx : dx);
  const y = y0 !== undefined ? y0 : MOBILE_VIEWPORT.height * 0.5;
  // dispatch real touch events (the carousel listens on touchstart/touchend,
  // not mouse events — so page.mouse would be ignored)
  const touch = await page.evaluateHandle(async ({ startX, endX, y }) => {
    const target = document.documentElement;
    const ts = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [touch],
        changedTouches: [touch], targetTouches: type === "touchend" ? [] : [touch],
      }));
    };
    ts("touchstart", startX, y);
    ts("touchmove", endX, y);
    ts("touchend", endX, y);
  }, { startX, endX, y });
  await touch.dispose();
}

// Two-finger swipe (simulated as a fast single drag across most of the
// viewport) — switches to the next active session.
export async function swipeTwoFinger(page, dir) {
  const y = MOBILE_VIEWPORT.height * 0.5;
  const startX = MOBILE_VIEWPORT.width * (dir === "left" ? 0.9 : 0.1);
  const endX = MOBILE_VIEWPORT.width * (dir === "left" ? 0.1 : 0.9);
  await page.evaluate(({ startX, endX, y }) => {
    const target = document.documentElement;
    const ts = (type, x, y, id) => {
      const touch = new Touch({ identifier: id, target, clientX: x, clientY: y });
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [touch],
        changedTouches: [touch], targetTouches: type === "touchend" ? [] : [touch],
      }));
    };
    ts("touchstart", startX, y, 1);
    ts("touchmove", endX, y, 1);
    ts("touchend", endX, y, 1);
  }, { startX, endX, y });
}

/** Make the workspace a git repo and return its path. */
export function initWorkspaceRepo(dir = "/workspace") {
  dexec(`
    set -e
    cd ${dir}
    git init -q 2>/dev/null || true
    git config user.email e2e@example.com
    git config user.name e2e
    git config commit.gpgsign false
  `);
  return dir;
}
