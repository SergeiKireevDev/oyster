// Records a dedicated video for each e2e test scenario.
// One video per test, named after the test, saved to /home/ubuntu/tree-pi/preview-videos/.
// Each scenario runs in its own container — fresh workspace, fresh session.

import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";

const TOKEN = "e2e-test-token";
const OUT = "/home/ubuntu/tree-pi/preview-videos";
const RAW = join(OUT, "raw");
const BASE_PORT = 4030;
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const WORKDIR = "/workspace";

function sh(cmd) { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function ctr(name, cmd) { return execSync(`docker exec ${name} bash -lc ${JSON.stringify(cmd)}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

async function startContainer(port) {
  const name = `pi-lot-video-${port}`;
  sh(`docker rm -f ${name} 2>/dev/null || true`);
  sh(`docker run -d --name ${name} -p ${port}:4000 -e PI_UI_TOKEN=${TOKEN} -e E2E_MOCK_LLM=1 pi-lot-ui`);
  const base = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${base}/runners`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) { up = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) throw new Error(`container on :${port} did not come up`);
  return { name, base };
}

function stopContainer(name) { sh(`docker rm -f ${name} 2>/dev/null || true`); }

// pause between actions so the video viewer can follow what is happening
const wait = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

async function swipe(page, dir) {
  const x0 = 78, dx = 200, y = 422;
  const endX = x0 + (dir === "left" ? -dx : dx);
  await page.evaluate(async ({ x0, endX, y }) => {
    const t = document.documentElement;
    const d = (type, x, y) => {
      const tw = new Touch({ identifier: 1, target: t, clientX: x, clientY: y });
      t.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tw], changedTouches: [tw], targetTouches: type === "touchend" ? [] : [tw] }));
    };
    d("touchstart", x0, y); d("touchmove", endX, y); d("touchend", endX, y);
  }, { x0, endX, y });
}

async function sendPrompt(page, text) {
  await page.fill("#input", text);
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.assistant", { timeout: 60000 });
  await page.waitForFunction(
    () => { const d = document.getElementById("connDot"); return d && d.classList.contains("ok") && !d.classList.contains("busy"); },
    { timeout: 60000 }
  );
}

async function freeze(page) {
  await page.locator(".checkpoint").click();
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.getByRole("button", { name: /Freeze/ }).click();
  await page.waitForFunction(() => !document.getElementById("overlay")?.classList.contains("open"));
  await wait();
}

function initGit(name) {
  ctr(name, `cd ${WORKDIR}; rm -rf .git e2e-notes.txt e2e-a.txt e2e-b.txt; git init -q; git config user.email e2e@e2e.e2e; git config user.name e2e; printf 'alpha\n' > e2e-notes.txt; git add -A; git commit -q -m 'baseline'`);
}

async function checkpoint_rollback_desktop(ctx) {
  const { page, ctrName } = ctx;
  initGit(ctrName);
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'beta\n' >> e2e-notes.txt; printf 'b\n' > e2e-a.txt`);
  await wait();
  await freeze(page);
  await wait();
  await sendPrompt(page, "Reply with exactly the word GAMMA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'gamma\n' >> e2e-notes.txt; printf 'c\n' > e2e-b.txt`);
  await wait();
  await freeze(page);
  await wait();
  await page.locator(".ckpt-restore").first().click();
  await wait();
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.getByRole("button", { name: /Roll back/ }).click();
  await wait(2000);
}

async function checkpoint_rollback_mobile(ctx) {
  const { page, ctrName } = ctx;
  initGit(ctrName);
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'beta\n' >> e2e-notes.txt; printf 'b\n' > e2e-a.txt`);
  await wait();
  await freeze(page);
  await wait();
  await sendPrompt(page, "Reply with exactly the word GAMMA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'gamma\n' >> e2e-notes.txt; printf 'c\n' > e2e-b.txt`);
  await wait();
  await freeze(page);
  await wait();
  await page.locator(".ckpt-restore").first().click();
  await wait();
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.getByRole("button", { name: /Roll back/ }).click();
  await wait(2000);
}

async function checkpoint_treebar_desktop(ctx) {
  const { page, ctrName } = ctx;
  initGit(ctrName);
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'beta\n' >> e2e-notes.txt; printf 'b\n' > e2e-a.txt`);
  await wait();
  await freeze(page);
  await wait();
  await sendPrompt(page, "Reply with exactly the word GAMMA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'gamma\n' >> e2e-notes.txt; printf 'c\n' > e2e-b.txt`);
  await wait();
  await freeze(page);
  await wait();
  // open treebar via chip
  await page.click("#treeChip");
  await wait(1500);
  // close the drawer so the chat arrows are clickable
  await page.click("#treeChip");
  await wait();
  // rollback via the in-chat arrow
  await page.locator(".ckpt-restore").first().click();
  await wait();
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.getByRole("button", { name: /Roll back/ }).click();
  await wait(1500);
  // reopen treebar to see the fork
  await page.click("#treeChip");
  await wait(1500);
  await page.click("#treeChip");
  await wait();
}

async function checkpoint_treebar_mobile(ctx) {
  const { page, ctrName } = ctx;
  initGit(ctrName);
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'beta\n' >> e2e-notes.txt; printf 'b\n' > e2e-a.txt`);
  await wait();
  await freeze(page);
  await wait();
  await sendPrompt(page, "Reply with exactly the word GAMMA.");
  await wait();
  ctr(ctrName, `cd ${WORKDIR}; printf 'gamma\n' >> e2e-notes.txt; printf 'c\n' > e2e-b.txt`);
  await wait();
  await freeze(page);
  await wait();
  // open treebar via chip
  await page.click("#treeChip");
  await wait(1500);
  // close drawer via swipe so the chat arrows are clickable
  await swipe(page, "right");
  await wait();
  await swipe(page, "right");
  await wait();
  // rollback via in-chat arrow
  await page.locator(".ckpt-restore").first().click();
  await wait();
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.getByRole("button", { name: /Roll back/ }).click();
  await wait(1500);
  // reopen treebar to see the fork
  await page.click("#treeChip");
  await wait(1500);
  await swipe(page, "right");
  await wait();
  await swipe(page, "right");
  await wait();
}

// ---- hublot ----

async function hublot_desktop(ctx) {
  const { page, ctrName } = ctx;
  const brief = 'Serve a minimal static web page on the local port. Its HTML body must contain exactly one <button> element with the visible text "Click me". No frameworks - a plain HTML response is fine. Keep the server running detached.';
  await wait();
  await page.click("#hublotAdd");
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.locator("#mBody textarea").fill(brief);
  await wait();
  await page.getByRole("button", { name: "Open hublot" }).click();
  await wait(2000);
  await page.waitForSelector(".hublot-block:not(.builtin)", { timeout: 60000 });
  await wait(2000);
  // close the hublot block via the X
  await page.locator(".hublot-block:not(.builtin) .cap .x").first().click();
  await wait(1500);
}

async function hublot_mobile(ctx) {
  const { page, ctrName } = ctx;
  const brief = 'Serve a minimal static web page on the local port. Its HTML body must contain exactly one <button> element with the visible text "Click me". No frameworks - a plain HTML response is fine. Keep the server running detached.';
  await wait();
  // on mobile, open the hublots drawer via the chip first
  await page.click("#hublotChip");
  await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  await wait();
  await page.click("#hublotAdd");
  await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"));
  await wait();
  await page.locator("#mBody textarea").fill(brief);
  await wait();
  await page.getByRole("button", { name: "Open hublot" }).click();
  await wait(2000);
  // the block appears in the drawer (builtin blocks are hidden; wait for a visible one)
  await page.waitForSelector(".hublot-block:not(.builtin)", { timeout: 60000 });
  await wait(2000);
  // close the block via the X
  await page.locator(".hublot-block:not(.builtin) .cap .x").first().click();
  await wait(1500);
  // close the drawer
  await swipe(page, "right");
  await wait();
}

// ---- routine ----

async function routine_desktop(ctx) {
  const { page } = ctx;
  await wait();
  const block = page.locator(".routine-block", { hasText: ROUTINE_NAME });
  await expect(block).toBeVisible({ timeout: 30000 });
  await wait();
  await block.getByRole("button", { name: /start/ }).click();
  await wait(3000);
  await expect(block).toContainText("100%", { timeout: 60000 });
  await wait();
  await block.getByRole("button", { name: /teardown/ }).click();
  await wait(2000);
}

async function routine_mobile(ctx) {
  const { page } = ctx;
  await wait();
  // on mobile open the hublots/routines sidebar to see the routine block
  await page.click("#hublotChip");
  await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  await wait(1500);
  const block = page.locator(".routine-block", { hasText: ROUTINE_NAME });
  await expect(block).toBeVisible({ timeout: 30000 });
  await wait();
  await block.getByRole("button", { name: /start/ }).click();
  await wait(3000);
  await expect(block).toContainText("100%", { timeout: 60000 });
  await wait();
  await block.getByRole("button", { name: /teardown/ }).click();
  await wait(2000);
}

// ---- sessions ----

async function sessions_desktop(ctx) {
  const { page } = ctx;
  await wait();
  // create session A
  await page.click("#menuBtn");
  await page.click('button[data-action="newSession"]');
  await page.waitForSelector(".toast", { timeout: 10000 });
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  // create session B
  await page.click("#menuBtn");
  await page.click('button[data-action="newSession"]');
  await page.waitForSelector(".toast", { timeout: 10000 });
  await wait();
  await sendPrompt(page, "Reply with exactly the word BETA.");
  await wait();
  // open sessions picker
  await page.click("#menuBtn");
  await page.click('button[data-action="sessions"]');
  await page.waitForFunction(() => document.getElementById("mTitle")?.textContent === "Sessions");
  await wait(1500);
  // search for a session
  const searchBox = page.locator('#mBody .search-row input[type=text]');
  await searchBox.fill("ALPHA");
  await searchBox.press("Enter");
  await page.waitForSelector('.search-hit', { timeout: 15000 });
  await wait(1500);
  // click a hit to switch sessions
  await page.locator('.search-hit').first().click();
  await page.waitForSelector('.toast', { timeout: 10000 });
  await wait(1500);
}

async function sessions_mobile(ctx) {
  const { page } = ctx;
  await wait();
  // create session A
  await page.click("#menuBtn");
  await page.click('button[data-action="newSession"]');
  await page.waitForSelector(".toast", { timeout: 10000 });
  await wait();
  await sendPrompt(page, "Reply with exactly the word ALPHA.");
  await wait();
  // create session B
  await page.click("#menuBtn");
  await page.click('button[data-action="newSession"]');
  await page.waitForSelector(".toast", { timeout: 10000 });
  await wait();
  await sendPrompt(page, "Reply with exactly the word BETA.");
  await wait();
  // open sessions picker
  await page.click("#menuBtn");
  await page.click('button[data-action="sessions"]');
  await page.waitForFunction(() => document.getElementById("mTitle")?.textContent === "Sessions");
  await wait(1500);
  // search
  const searchBox = page.locator('#mBody .search-row input[type=text]');
  await searchBox.fill("ALPHA");
  await searchBox.press("Enter");
  await page.waitForSelector('.search-hit', { timeout: 15000 });
  await wait(1500);
  await page.locator('.search-hit').first().click();
  await page.waitForSelector('.toast', { timeout: 10000 });
  await wait(1500);
}

const SCENARIOS = [
  { name: "checkpoint-rollback-desktop", fn: checkpoint_rollback_desktop, mobile: false, setup: null },
  { name: "checkpoint-rollback-mobile", fn: checkpoint_rollback_mobile, mobile: true, setup: null },
  { name: "checkpoint-treebar-desktop", fn: checkpoint_treebar_desktop, mobile: false, setup: null },
  { name: "checkpoint-treebar-mobile", fn: checkpoint_treebar_mobile, mobile: true, setup: null },
  { name: "hublot-desktop", fn: hublot_desktop, mobile: false, setup: null },
  { name: "hublot-mobile", fn: hublot_mobile, mobile: true, setup: null },
  { name: "routine-desktop", fn: routine_desktop, mobile: false, setup: setup_routine },
  { name: "routine-mobile", fn: routine_mobile, mobile: true, setup: setup_routine },
  { name: "sessions-desktop", fn: sessions_desktop, mobile: false, setup: null },
  { name: "sessions-mobile", fn: sessions_mobile, mobile: true, setup: null },
];

const ROUTINE_NAME = "e2e-dummy.sh";
const ROUTINE_SCRIPT = "#!/bin/bash\nset -e\nmode=${1:-run}\nartifact=/workspace/.e2e-routine-artifact\ncase \"$mode\" in\n  run)\n    echo \"::progress 25 starting\"\n    sleep 1\n    echo \"::progress 50 half done\"\n    sleep 1\n    echo \"::progress 75 almost\"\n    sleep 1\n    printf 'byproduct' > \"$artifact\"\n    echo \"::progress 100 complete\"\n    ;;\n  teardown)\n    rm -f \"$artifact\"\n    echo \"byproduct removed\"\n    ;;\nesac\n";

function setup_routine(ctrName) {
  const b64 = Buffer.from(ROUTINE_SCRIPT).toString("base64");
  ctr(ctrName, `mkdir -p "$HOME/.pi/routines"; echo "${b64}" | base64 -d > "$HOME/.pi/routines/${ROUTINE_NAME}"; chmod +x "$HOME/.pi/routines/${ROUTINE_NAME}"`);
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const results = [];

  for (const sc of SCENARIOS) {
    const port = BASE_PORT + results.length;
    console.log(`\n=== ${sc.name} ===`);
    const { name: ctrName, base } = await startContainer(port);
    if (sc.setup) { await sc.setup(ctrName); }

    const browser = await chromium.launch({ headless: true, executablePath: CHROME });
    const vp = sc.mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 };
    const context = await browser.newContext({ recordVideo: { dir: RAW, size: vp }, viewport: vp });
    context.setDefaultTimeout(60000);
    const page = await context.newPage();

    try {
      await page.goto(`${base}/#token=${TOKEN}`);
      await page.waitForSelector("#connDot.ok", { timeout: 30000 });
      await wait();
      await sc.fn({ page, ctrName, base });
      results.push({ name: sc.name, status: "ok" });
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      results.push({ name: sc.name, status: "failed", error: e.message });
    } finally {
      await context.close();
      await browser.close();
      stopContainer(ctrName);
    }
  }

  const files = readdirSync(RAW).filter((f) => f.endsWith(".webm"))
    .sort((a, b) => statSync(join(RAW, a)).mtimeMs - statSync(join(RAW, b)).mtimeMs);
  console.log(`\nRecorded ${files.length} videos:`);
  for (let i = 0; i < files.length; i++) {
    const sc = SCENARIOS[i];
    if (sc) {
      const dest = join(OUT, `${sc.name}.webm`);
      renameSync(join(RAW, files[i]), dest);
      console.log(`  ${sc.name} -> ${dest}`);
    }
  }

  console.log("\nResults:");
  for (const r of results) {
    console.log(`  ${r.status === "ok" ? "✓" : "✗"} ${r.name}${r.error ? ` (${r.error})` : ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
