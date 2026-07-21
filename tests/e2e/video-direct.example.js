import { test, expect } from "@playwright/test";
import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("direct video", async ({}) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: join(ROOT, "preview-videos", "raw"), size: { width: 800, height: 600 } },
  });
  const page = await context.newPage();
  await page.goto("data:text/html,<h1>Hello World</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Hello World");
  await context.close();
  await browser.close();
});
