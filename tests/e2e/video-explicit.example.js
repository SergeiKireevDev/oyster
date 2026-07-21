import { test, expect } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test.use({ recordVideo: { dir: join(ROOT, "preview-videos", "raw"), size: { width: 800, height: 600 } } });

test("explicit video", async ({ page }) => {
  await page.goto("data:text/html,<h1>Hello Explicit</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Hello Explicit");
});
