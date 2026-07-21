import { test, expect } from "@playwright/test";
import { chromium } from "@playwright/test";

test("direct video", async ({}) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: "/home/ubuntu/tree-pi/preview-videos/raw", size: { width: 800, height: 600 } },
  });
  const page = await context.newPage();
  await page.goto("data:text/html,<h1>Hello World</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Hello World");
  await context.close();
  await browser.close();
});
