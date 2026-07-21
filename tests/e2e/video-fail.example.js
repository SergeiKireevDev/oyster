import { test, expect } from "@playwright/test";

test.use({ recordVideo: { dir: "/home/ubuntu/tree-pi/preview-videos/raw", size: { width: 800, height: 600 } } });

test("video smoke", async ({ page }) => {
  await page.goto("data:text/html,<h1>Video Smoke</h1>");
  await expect(page.locator("h1")).toHaveText("Video Smoke");
});
