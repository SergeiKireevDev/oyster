import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
if (existsSync(SYSLIBS)) {
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
const launchOptions = SHELL ? { executablePath: SHELL } : {};

// These specs drive ONE shared pi-lot-ui container (and one shared pi agent /
// workspace) through the real browser UI, so they must run sequentially — no
// parallelism, one worker. The hublot spec spawns a background agent and a
// real cloudflared tunnel, so timeouts are generous.
//
// Every test is authored once in a `body(mobile)` helper and then DUPLICATED
// as a desktop test (wide viewport) and a mobile test (narrow viewport that
// triggers the slide-over drawer + swipe carousel). Both run on the same
// container — desktop first, then mobile (or vice-versa) — which catches bugs
// that only surface at one breakpoint (e.g. a handler that works on desktop
// but is dead on mobile because the click target is behind a drawer).
//
// The two top-level test.describe("desktop") / test.describe("mobile") blocks
// are intentionally tagged so you can run just one with `--grep`.
const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60 * 1000, // per test (hublot agent + tunnel can take minutes)
  expect: { timeout: 30 * 1000 },
  globalSetup: "./global-setup.js",
  globalTeardown: "./global-teardown.js",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PI_UI_URL ?? "http://localhost:4000",
    viewport: { width: 1400, height: 900 }, // desktop is the default
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
