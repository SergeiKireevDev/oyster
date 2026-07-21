import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.PREVIEW_TOKEN ?? "2d6bd17908aa427ef997c05d77f977ec";
const BASE_URL = process.env.PREVIEW_URL ?? "http://176.9.23.106:8080/s/019f3bc8-c1ad-7c34-9101-0c0398b97997";
const PAGE_URL = `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}token=${TOKEN}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots") + "/";
mkdirSync(OUT, { recursive: true });

const targets = [
  { name: "iphone-15", label: "iPhone 15", ...devices["iPhone 15"] },
  { name: "iphone-15-pro-max", label: "iPhone 15 Pro Max", ...devices["iPhone 15 Pro Max"] },
  { name: "ipad-portrait", label: "iPad Pro 11 — Portrait", ...devices["iPad Pro 11"] },
  { name: "ipad-landscape", label: "iPad Pro 11 — Landscape", ...devices["iPad Pro 11 landscape"] },
  { name: "desktop-1080p", label: "Desktop 1920×1080", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { name: "laptop-1440", label: "Laptop 1440×900", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
];

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const manifest = [];
for (const t of targets) {
  const { name, label, ...ctxOpts } = t;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  console.log(`capturing ${label} (${ctxOpts.viewport.width}x${ctxOpts.viewport.height})...`);
  await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}${name}.png` });
  manifest.push({ file: `shots/${name}.png`, label, width: ctxOpts.viewport.width, height: ctxOpts.viewport.height, dpr: ctxOpts.deviceScaleFactor ?? 1 });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(manifest, null, 2));
