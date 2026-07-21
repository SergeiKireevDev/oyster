import { test, expect } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test.use({ recordVideo: { dir: join(ROOT, "preview-videos", "raw"), size: { width: 800, height: 600 } } });

test("video smoke", async ({ page }) => {
  await page.goto("data:text/html,<h1>Video Smoke</h1>");
  await expect(page.locator("h1")).toHaveText("Video Smoke");
});
