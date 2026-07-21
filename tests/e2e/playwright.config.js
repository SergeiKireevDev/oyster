import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// This host (Debian trixie, no root) can't apt-install Chromium's system libs,
// so we run the lighter chrome-headless-shell against a rootless lib prefix at
// ~/.pw-syslibs (populated once via `apt-get download` + dpkg-deb -x). Wire
// both up here so `npm test` just works. If neither exists we fall back to
// Playwright's default browser resolution.
function headlessShellPath() {
  const base = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    if (!d.startsWith("chromium_headless_shell-")) continue;
    const p = join(base, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  return null;
}

const SYSLIBS = join(homedir(), ".pw-syslibs");
if (existsSync(SYSLIBS) && !process.env.E2E_VIDEO) {
  const dirs = [
    join(SYSLIBS, "usr/lib/x86_64-linux-gnu"),
    join(SYSLIBS, "usr/lib/x86_64-linux-gnu/gbm"),
  ].filter(existsSync);
  process.env.LD_LIBRARY_PATH = [...dirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  // headless-shell FATALs ("SkFontMgr … Not implemented") when fontconfig finds
  // no fonts; point it at the fonts.conf + DejaVu font shipped in the prefix.
  const fc = join(SYSLIBS, "fonts.conf");
  if (existsSync(fc)) {
    process.env.FONTCONFIG_FILE = fc;
    process.env.FONTCONFIG_PATH = SYSLIBS;
  }
}
const SHELL = headlessShellPath();
const ACTION_DELAY_MS = Number(process.env.E2E_ACTION_DELAY_MS ?? (process.env.E2E_VIDEO ? 1000 : 0));
const launchOptions = SHELL ? { executablePath: SHELL, slowMo: ACTION_DELAY_MS } : { slowMo: ACTION_DELAY_MS };
// Video is opt-in: recording every normal e2e run leaves large artifacts in
// preview-videos/. Also, chrome-headless-shell cannot record video, so when
// E2E_VIDEO is set we let Playwright use its bundled full Chromium instead.
// In video mode, do not force the rootless ~/.pw-syslibs fontconfig file: it
// only points at DejaVu fonts, so emoji/icon controls render as tofu boxes in
// recordings. Full Chromium can use the host fontconfig, including Noto Emoji.
// E2E_ACTION_DELAY_MS adds a configurable pause between browser actions so
// recordings are readable instead of instantly jumping from state to state.
const videoOutputDir = process.env.E2E_VIDEO_DIR ?? join(HERE, "..", "..", "preview-videos", "raw");
const projectUse = process.env.E2E_VIDEO
  ? {
      ...devices["Desktop Chrome"],
      video: { mode: "on" },
      launchOptions: { headless: true, slowMo: ACTION_DELAY_MS },
    }
  : { ...devices["Desktop Chrome"], launchOptions };

// Specs run in isolated per-test containers. `lib/reset.js` allocates a host
// port from 4000..4018 for each live test and tears that container down in
// afterEach, so the suite can run in parallel without workspace/session bleed.
// Keep concurrency capped to avoid overwhelming Docker, the mock LLM, and the
// local browser.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.js/,
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 9,
  retries: 0,
  timeout: 6 * 60 * 1000, // per test (hublot agent + tunnel can take minutes)
  expect: { timeout: 30 * 1000 },
  globalSetup: "./global-setup.js",
  globalTeardown: "./global-teardown.js",
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: process.env.E2E_VIDEO ? videoOutputDir : undefined,
  use: {
    baseURL: process.env.PI_UI_URL ?? "http://localhost:4000",
    viewport: { width: 1400, height: 900 }, // desktop is the default
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [{ name: "chromium", use: projectUse }],
});
