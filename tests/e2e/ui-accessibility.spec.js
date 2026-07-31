import { test, expect } from "@playwright/test";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

test("folder intent renders an accessible dialog with trapped and restored focus", async ({ page }) => {
  await login(page);

  const opener = page.locator("#newSessionFolder");
  await expect(opener).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/browse" && response.ok()),
    opener.click(),
  ]);

  const dialog = page.getByRole("dialog", { name: "New session in folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".m-path").first()).toContainText("/workspace");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("button:focus, input:focus, [tabindex]:focus")).toHaveCount(1);

  const controls = dialog.locator("button:visible, input:visible, select:visible, textarea:visible, a[href]:visible");
  const first = controls.first();
  const last = controls.last();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("#mTitle")).toHaveText("");
});
