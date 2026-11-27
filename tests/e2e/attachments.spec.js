// Composer attachments — driven through the UI against the mock-LLM container:
//   A. a temporary attachment lands in a private /tmp folder and is only sent
//      with the message the user composes afterwards
//   B. a permanent attachment is dropped into a folder picked from the workdir
//   C. the file explorer creates a folder in the directory it lists

import { test, expect } from "@playwright/test";
import { login, dexec } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

const RUN = Date.now();

async function chooseFile(page, name, content) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#attachBtn")]);
  await chooser.setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
}

test("a temporary attachment waits in the composer and is sent with the composed message", async ({ page }) => {
  await login(page);
  const name = `note-${RUN}.txt`;
  const userMessages = page.locator(".msg.user");
  const before = await userMessages.count();

  await chooseFile(page, name, "temporary attachment");
  await expect(page.locator("#mTitle")).toHaveText(`Attach ${name}`);
  await page.getByText("Temporary — keep it in /tmp").click();

  const chip = page.locator("#composerAttachments .attachment", { hasText: name });
  await expect(chip).not.toHaveClass(/uploading/);
  await expect(chip.locator(".attachment-kind")).toHaveText("tmp");
  const path = (await chip.getAttribute("title")).split(" — ")[0];
  expect(path).toMatch(new RegExp(`^/tmp/oyster-attachments/[^/]+/${name}$`));
  expect(dexec(`cat ${path}`)).toBe("temporary attachment");
  // Attaching alone must not put anything in the conversation.
  await expect(userMessages).toHaveCount(before);
  await expect(page.locator("#sendBtn")).toBeEnabled();

  await page.fill("#input", "Reply with exactly the word ATTACHED");
  await page.click("#sendBtn");
  await expect(userMessages.last()).toContainText(`Attached file:`);
  await expect(userMessages.last()).toContainText(path);
  await expect(page.locator("#composerAttachments")).toHaveCount(0);
  await expect(page.locator("#input")).toHaveValue("");
});

test("a permanent attachment is dropped into a folder chosen from the working directory", async ({ page }) => {
  const folder = `attachments-${RUN}`;
  dexec(`mkdir -p /workspace/${folder}`);
  await login(page);
  const name = `spec-${RUN}.md`;

  await chooseFile(page, name, "# permanent");
  await page.getByText("Permanent — choose a folder…").click();
  await expect(page.locator("#mTitle")).toHaveText(`Save ${name} to…`);
  await expect(page.locator(".folder-browser-path")).toHaveText("/workspace");
  await page.locator("#mBody").getByText(folder, { exact: true }).click();
  await expect(page.locator(".folder-browser-path")).toHaveText(`/workspace/${folder}`);
  await page.getByRole("button", { name: "Drop here" }).click();

  const chip = page.locator("#composerAttachments .attachment", { hasText: name });
  await expect(chip).not.toHaveClass(/uploading/);
  await expect(chip.locator(".attachment-kind")).toHaveText("saved");
  await expect(chip).toHaveAttribute("title", new RegExp(`^/workspace/${folder}/${name} — `));
  expect(dexec(`cat /workspace/${folder}/${name}`)).toBe("# permanent");

  // Removing the chip detaches the file from the message but leaves it where it was saved.
  await chip.getByRole("button", { name: `Remove attachment ${name}` }).click();
  await expect(page.locator("#composerAttachments")).toHaveCount(0);
  expect(dexec(`test -f /workspace/${folder}/${name} && echo kept`)).toBe("kept");
});

test("the file explorer creates a new folder in the listed directory", async ({ page }) => {
  await login(page);
  const folder = `explorer-folder-${RUN}`;
  const filesWidget = page.locator("#hublots .pinned-widget-cell", { hasText: "Files" }).first();
  if (!await filesWidget.isVisible()) await page.getByRole("button", { name: "Widgets" }).click();
  await filesWidget.locator(".pinned-widget-tile").click();
  await expect(page.locator("#mTitle")).toHaveText("File explorer");

  await page.getByRole("button", { name: "New folder" }).click();
  await page.fill("#explorerNewFolderName", folder);
  await page.keyboard.press("Enter");
  await expect(page.locator("#mBody").getByText(folder, { exact: true })).toBeVisible();
  await expect(page.locator("#explorerNewFolderName")).toHaveCount(0);
  expect(dexec(`test -d /workspace/${folder} && echo created`)).toBe("created");

  await page.getByRole("button", { name: "New folder" }).click();
  await page.fill("#explorerNewFolderName", folder);
  await page.keyboard.press("Enter");
  await expect(page.locator("#explorerNewFolderError")).toContainText("already exists");
});
