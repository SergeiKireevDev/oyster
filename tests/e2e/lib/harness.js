// Shared helpers for the pi-lot-ui Playwright e2e suite.
//
// The tests target a SELF-CONTAINED pi-lot-ui container on port 4000 whose image
// bundles the deterministic mock LLM (activated via E2E_MOCK_LLM=1), so there
// are no credential mounts and no external model calls. They drive the product
// two ways:
//   - through the browser UI (Playwright) — the primary surface under test
//   - through `docker exec` into the container for out-of-band setup and
//     assertions on the container filesystem (git repos, served ports, …)
// and through the HTTP API for a few read-only cross-checks.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, "..", ".e2e-state.json");

export const BASE = process.env.PI_UI_URL ?? "http://localhost:4000";
export const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const DEFAULT_CONTAINER = process.env.PI_UI_CONTAINER ?? "pi-lot-e2e";

/** Name of the container the suite drives (recorded by global-setup). */
export function containerName() {
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

/** HTTP call against the server with the bearer token. */
export async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
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
  await page.goto(`/#token=${TOKEN}`);
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

/** Type a prompt into the composer, send it, and wait for the agent turn to
 *  finish (busy dot clears and at least one assistant message is present). */
export async function sendPrompt(page, text, { timeout = 120000 } = {}) {
  const before = await page.locator(".msg.assistant").count();
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
