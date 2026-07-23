import { test, expect } from "@playwright/test";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

test.use({ viewport: { width: 320, height: 568 } });

async function openMenuModal(page, action, title) {
  await page.locator("#menuBtn").click();
  await page.locator(`#menu button[data-action="${action}"]`).click();
  await expect(page.locator("#mTitle")).toHaveText(title);
}

async function closeModal(page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);
}

async function expectButtonsToFit(page, content) {
  const failures = await page.locator("#modal").evaluate((modal) => {
    const viewport = { width: innerWidth, height: innerHeight };
    const failures = [];
    const visibleButtons = [...modal.querySelectorAll("button, .m-actions a")]
      .filter((button) => button.getClientRects().length > 0);
    const actionSelector = ".m-actions, .browser-list-actions";
    const actionControls = visibleButtons.filter((button) => button.closest(actionSelector));
    const otherControls = visibleButtons.filter((button) => !button.closest(actionSelector));

    function checkControl(button) {
      const rect = button.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      const tolerance = 1;
      if (
        rect.left < Math.max(0, modalRect.left) - tolerance ||
        rect.right > Math.min(viewport.width, modalRect.right) + tolerance ||
        rect.top < Math.max(0, modalRect.top) - tolerance ||
        rect.bottom > Math.min(viewport.height, modalRect.bottom) + tolerance
      ) {
        failures.push(`${button.textContent.trim() || button.title}: ${Math.round(rect.left)},${Math.round(rect.top)}–${Math.round(rect.right)},${Math.round(rect.bottom)}`);
      }
    }

    // Footer actions must all be visible together as soon as the modal opens.
    for (const button of actionControls) checkControl(button);
    for (const actions of modal.querySelectorAll(actionSelector)) {
      if (actions.scrollWidth > actions.clientWidth + 1) {
        failures.push(`action row overflows: ${actions.scrollWidth}px > ${actions.clientWidth}px`);
      }
    }

    // Long file and session lists may scroll, but each of their controls must
    // fit completely once brought into the visible part of the modal.
    for (const button of otherControls) {
      button.scrollIntoView({ block: "nearest" });
      checkControl(button);
    }
    return failures;
  });

  expect(failures, `${content} has clipped mobile controls`).toEqual([]);
}

test("every modal keeps all buttons entirely visible on mobile", async ({ page }) => {
  await login(page);

  const scenarios = [
    { name: "settings", open: () => openMenuModal(page, "settings", "Settings") },
    { name: "analytics", open: () => openMenuModal(page, "analytics", "Usage analytics") },
    {
      name: "folder browser",
      open: async () => {
        await page.evaluate(() => document.getElementById("sessions")?.classList.add("open"));
        await page.locator("#newSessionFolder").click();
        await expect(page.locator("#mTitle")).toHaveText("New session in folder");
      },
    },
    {
      name: "routine generator",
      open: async () => {
        await page.evaluate(() => document.getElementById("hublots")?.classList.add("open"));
        await page.locator("#routineAdd").click();
        await expect(page.locator("#mTitle")).toHaveText("New routine");
      },
    },
    {
      name: "hublot manager",
      open: async () => {
        await page.evaluate(() => document.getElementById("hublots")?.classList.add("open"));
        await page.locator("#hublotAdd").click();
        await expect(page.locator("#mTitle")).toContainText("Hublots");
      },
    },
    {
      name: "file explorer",
      open: async () => {
        await page.evaluate(() => document.getElementById("hublots")?.classList.add("open"));
        await page.locator("#hublotList .hublot-block").first().click();
        await expect(page.locator("#mTitle")).toHaveText("File explorer");
      },
    },
  ];

  for (const scenario of scenarios) {
    await scenario.open();
    await expect(page.locator("#overlay")).toHaveClass(/open/);
    await expectButtonsToFit(page, scenario.name);
    await closeModal(page);
    await page.evaluate(() => {
      document.getElementById("sessions")?.classList.remove("open");
      document.getElementById("hublots")?.classList.remove("open");
    });
  }
});
