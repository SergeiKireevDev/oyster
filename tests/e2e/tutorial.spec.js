import { expect, test } from "@playwright/test";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => teardownContainer());

test("first-run tour waits for credentials, persists dismissal, and can be replayed", async ({ page }) => {
  await page.route("**/api-keys", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [{
          provider: "mock", displayName: "Mock", configured: false,
          credentialType: null, source: "not_configured", registered: true,
        }],
      }),
    });
  });
  await login(page, { keepCredentialSetup: true });

  await expect(page.locator("#mTitle")).toHaveText("Set up credentials");
  await expect(page.locator(".tutorial-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);

  const tutorial = page.locator(".tutorial-card");
  await expect(tutorial).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Welcome to Oyster");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Keep sessions close");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Welcome to Oyster");
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(tutorial).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oyster_tutorial_v1_complete"))).toBe("1");

  await login(page, { keepCredentialSetup: true });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);
  await page.waitForTimeout(500);
  await expect(tutorial).toHaveCount(0);

  await page.locator("#menuBtn").click();
  await page.getByRole("menuitem", { name: "Take the tour…" }).click();
  await expect(tutorial).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Welcome to Oyster");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Next" }).click();
  const swipePrompt = page.locator(".tutorial-swipe-prompt");
  await expect(swipePrompt).toBeVisible();
  await expect(swipePrompt).toContainText("Swipe right");
  await expect(page.locator(".tutorial-scrim")).toBeHidden();
  await expect(page.locator(".tutorial-spotlight")).toBeHidden();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(swipePrompt).toBeVisible();
  await expect(swipePrompt).toContainText("Swipe left");
  await expect(page.locator(".tutorial-scrim")).toBeHidden();

  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator("#menuBtn")).toBeFocused();
});
