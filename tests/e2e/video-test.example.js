import { test, expect } from "@playwright/test";
test("video test", async ({ page }) => {
  await page.goto("data:text/html,<h1>Hello</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Hello");
});
