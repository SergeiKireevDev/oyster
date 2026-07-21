import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("config video step 1", async ({ page }) => {
  await page.goto("data:text/html,<h1>Step 1</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Step 1");
});

test("config video step 2", async ({ page }) => {
  await page.goto("data:text/html,<h1>Step 2</h1>");
  await page.waitForTimeout(2000);
  await expect(page.locator("h1")).toHaveText("Step 2");
});
