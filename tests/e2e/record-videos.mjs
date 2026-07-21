// Records videos of the mobile swipe-carousel and treebar interactions.
// Uses the Playwright API directly (not the test runner) because the runner
// config approach doesn't produce videos with headless chromium on this host.
//
// Usage: node record-videos.mjs

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const TOKEN = "e2e-test-token";
const CONTROLLER = "pi-lot-video";
const PORT = 4030;
const BASE = `http://localhost:${PORT}`;
const OUT = join(ROOT, "preview-videos");
const RAW = join(OUT, "raw");

function sh(cmd) { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

async function main() {
  mkdirSync(RAW, { recursive: true });

  // build image if needed
  try { sh(`docker images -q pi-lot-ui`); } catch {
    sh(`docker build -t pi-lot-ui ${JSON.stringify(ROOT)}`);
  }

  // start container
  sh(`docker rm -f ${CONTROLLER} 2>/dev/null || true`);
  sh(`docker run -d --name ${CONTROLLER} -p ${PORT}:4000 -e PI_UI_TOKEN=${TOKEN} -e E2E_MOCK_LLM=1 pi-lot-ui`);

  // wait for it to come up
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/runners`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) { up = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) throw new Error("container did not come up");

  const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const context = await browser.newContext({
    recordVideo: { dir: RAW, size: { width: 390, height: 844 } }, // mobile
    viewport: { width: 390, height: 844 },
  });
  context.setDefaultTimeout(30000);

  const page = await context.newPage();
  await page.goto(`${BASE}/#token=${TOKEN}`);
  await page.waitForSelector("#connDot.ok", { timeout: 30000 });

  // helper: swipe left (advance carousel), swipe right (go back)
  const swipe = async (dir) => {
    const x0 = 78, dx = 200, y = 422;
    const endX = x0 + (dir === "left" ? -dx : dx);
    const touch = await page.evaluateHandle(async ({ x0, endX, y }) => {
      const target = document.documentElement;
      const ts = (type, x, y) => {
        const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
        target.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: type === "touchend" ? [] : [touch],
          changedTouches: [touch], targetTouches: type === "touchend" ? [] : [touch],
        }));
      };
      ts("touchstart", x0, y); ts("touchmove", endX, y); ts("touchend", endX, y);
    }, { x0, endX, y });
    await touch.dispose();
  };

  // ---- Scenario 1: swipe to open hublots drawer ----
  console.log("Recording: swipe to open hublots...");
  await page.evaluate(() => {
    document.getElementById("hublots")?.classList.remove("open");
    document.getElementById("treebar")?.classList.remove("open");
  });
  await page.waitForTimeout(500);
  await swipe("left");
  await page.waitForTimeout(1500);
  // swipe again to go to checkpoints
  await swipe("left");
  await page.waitForTimeout(1500);
  // swipe right to go back
  await swipe("right");
  await page.waitForTimeout(1000);
  await swipe("right");
  await page.waitForTimeout(1000);

  // ---- Scenario 2: open treebar via chip, see checkpoints ----
  console.log("Recording: chip opens treebar, see checkpoints...");
  // send a prompt first so there's a session file
  await page.fill("#input", "Do not use any tools. Reply with exactly the word ALPHA.");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.assistant", { timeout: 60000 });
  await page.waitForTimeout(500);
  // freeze
  await page.locator(".checkpoint").click();
  await page.waitForSelector("#overlay.open");
  await page.getByRole("button", { name: /Freeze/ }).click();
  await page.waitForTimeout(500);
  // open treebar via chip
  await page.click("#treeChip");
  await page.waitForTimeout(2000);
  // close via swipe
  await swipe("right");
  await swipe("right");
  await page.waitForTimeout(1000);

  // ---- Scenario 3: two-finger swipe switches sessions ----
  console.log("Recording: two-finger swipe...");
  // first, open the sessions picker to see what's available
  await page.locator("#input").fill(":sessions");
  await page.locator("#input").press("Enter");
  await page.waitForSelector("#mTitle");
  await page.waitForTimeout(1500);
  // close modal
  await page.click("#overlay");
  await page.waitForTimeout(500);

  await context.close();
  await browser.close();

  // rename videos with meaningful names
  const files = readdirSync(RAW).filter((f) => f.endsWith(".webm"));
  console.log(`Recorded ${files.length} videos`);
  for (const f of files) {
    console.log(`  ${f}`);
  }

  // tear down
  sh(`docker rm -f ${CONTROLLER}`);
  console.log(`Videos saved to ${RAW}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
