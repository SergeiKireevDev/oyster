import { expect, test } from "@playwright/test";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.use({ hasTouch: true });
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => teardownContainer());

async function swipeTutorial(page, direction) {
  await page.locator(".tutorial-layer").evaluate((target, swipeDirection) => {
    const y = window.innerHeight * 0.68;
    const startX = swipeDirection === "right" ? 55 : window.innerWidth - 55;
    const endX = swipeDirection === "right" ? window.innerWidth - 55 : 55;
    const dispatch = (type, x) => {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [touch],
        changedTouches: [touch],
        targetTouches: type === "touchend" ? [] : [touch],
      }));
    };
    dispatch("touchstart", startX);
    dispatch("touchmove", endX);
    dispatch("touchend", endX);
  }, direction);
}

test("first-run tour waits for credentials, persists per form factor, and can be replayed", async ({ page }) => {
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
  await page.getByRole("button", { name: "Skip tour" }).tap();
  await expect(tutorial).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oyster_tutorial_v1_complete_desktop"))).toBe("1");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oyster_tutorial_v1_complete_mobile"))).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  // Closing credential setup is remembered, so it may not reopen on this
  // second login. Let the shared helper close it only if it is present while
  // preserving the mobile tutorial that follows.
  await login(page, { keepTutorial: true });
  if (!(await tutorial.isVisible())) {
    await page.locator("#menuBtn").click();
    await page.getByRole("menuitem", { name: "Take the tour…" }).click();
  }
  await expect(tutorial).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Welcome to Oyster");

  await page.getByRole("button", { name: "Next" }).click();
  const swipePrompt = page.locator(".tutorial-swipe-prompt");
  await expect(swipePrompt).toBeVisible();
  await expect(swipePrompt).toContainText("Swipe right");
  await expect(page.locator(".tutorial-scrim")).toBeHidden();
  await expect(page.locator(".tutorial-spotlight")).toBeHidden();

  await swipeTutorial(page, "right");
  await expect(page.locator("#sessions")).toBeVisible();
  await expect(page.locator(".tutorial-card")).toBeHidden();
  await expect(swipePrompt).toContainText("Swipe left to close");

  await swipeTutorial(page, "left");
  await expect(page.locator("#sessions")).toBeHidden();
  await expect(page.locator("#tutorialTitle")).toHaveText("Tell pi what to build");
  await expect(page.locator(".tutorial-card")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(swipePrompt).toBeVisible();
  await expect(swipePrompt).toContainText("Swipe left");
  await expect(page.locator(".tutorial-scrim")).toBeHidden();

  await swipeTutorial(page, "left");
  await expect(page.locator("#hublots")).toBeVisible();
  await expect(page.locator(".tutorial-card")).toBeHidden();
  await expect(swipePrompt).toContainText("Swipe right to close");

  await swipeTutorial(page, "right");
  await expect(page.locator("#hublots")).toBeHidden();
  await expect(page.locator("#tutorialTitle")).toHaveText("You're ready");
  await expect(page.locator(".tutorial-card")).toBeVisible();

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(tutorial).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oyster_tutorial_v1_complete_mobile"))).toBe("1");

  await page.locator("#menuBtn").click();
  await page.getByRole("menuitem", { name: "Take the tour…" }).click();
  await expect(tutorial).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(tutorial).toHaveCount(0);
  await expect(page.locator("#menuBtn")).toBeFocused();
});
