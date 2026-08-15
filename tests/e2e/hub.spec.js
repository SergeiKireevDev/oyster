import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_VIEWPORT, swipe } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
let hubProcess = null;
let hubDirectory = null;
let hubUrl = null;
let hubOutput = "";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function startHub() {
  const port = await freePort();
  hubDirectory = mkdtempSync(join(tmpdir(), "oyster-hub-e2e-"));
  const configPath = join(hubDirectory, "config.json");
  const tokenPath = join(hubDirectory, "ui-token");
  writeFileSync(tokenPath, `${process.env.OYSTER_TOKEN}\n`);
  writeFileSync(configPath, JSON.stringify({
    host: "127.0.0.1",
    port,
    token: "unused-config-fallback",
    sharedTokenFile: tokenPath,
    driver: {
      type: "mock",
      endpoint: process.env.OYSTER_URL,
      environmentId: "local",
      environmentName: "Local",
      id: "local",
      name: "Local E2E",
    },
  }));
  hubProcess = spawn(process.execPath, ["oyster-hub/server.mjs", "--config", configPath], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hubProcess.stdout.on("data", (chunk) => { hubOutput += chunk; });
  hubProcess.stderr.on("data", (chunk) => { hubOutput += chunk; });
  hubUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (hubProcess.exitCode != null) throw new Error(`Hub exited during startup (${hubProcess.exitCode})\n${hubOutput}`);
    try {
      const response = await fetch(`${hubUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Hub did not start\n${hubOutput}`);
}

async function stopHub() {
  if (hubProcess?.exitCode == null) {
    hubProcess.kill("SIGTERM");
    await Promise.race([once(hubProcess, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (hubProcess.exitCode == null) hubProcess.kill("SIGKILL");
  }
  hubProcess = null;
  if (hubDirectory) rmSync(hubDirectory, { recursive: true, force: true });
  hubDirectory = null;
  hubUrl = null;
  hubOutput = "";
}

test.beforeEach(async () => {
  await ensureContainer();
  await startHub();
});

test.afterEach(async () => {
  await stopHub();
  teardownContainer();
});

test.use({ viewport: MOBILE_VIEWPORT });

test("Hub mobile session creation starts from its workspace card", async ({ page }) => {
  await page.goto(`${hubUrl}/#token=${process.env.OYSTER_TOKEN}`);
  await page.waitForSelector("#connDot.ok", { timeout: 30_000 });
  const credentialSetup = page.locator("#mTitle", { hasText: "Set up credentials" });
  if (await credentialSetup.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await page.getByRole("button", { name: "Close" }).click();
  }

  for (let attempt = 0; attempt < 3 && !(await page.locator("#sessions").isVisible()); attempt += 1) {
    await swipe(page, "right");
  }
  await expect(page.locator("#sessions")).toBeVisible();

  const environmentSelector = page.locator(".session-sidebar-environment-selector select");
  await expect(environmentSelector).toHaveValue("local");
  await expect(environmentSelector.locator("option")).toHaveText(["Local"]);
  await page.getByRole("button", { name: "Show environment information for Local" }).click();
  const environmentInfo = page.getByRole("region", { name: "Environment information for Local" });
  await expect(environmentInfo).toContainText("Direct Hub connection");
  await expect(environmentInfo).toContainText("Workspaces");
  await expect(environmentInfo).toContainText("1");
  await page.getByRole("button", { name: "Close environment information" }).click();
  await expect(page.getByRole("button", { name: "Connect a cloud provider" })).toBeVisible();
  const workspaceContainer = page.locator(".session-sidebar-environment-view .session-sidebar-workspace-container", {
    has: page.locator(".session-sidebar-workspace-heading", { hasText: "Local E2E" }),
  });
  await expect(workspaceContainer).toBeVisible();
  const newSession = workspaceContainer.locator(".session-sidebar-workspace-create");
  await expect(newSession).toHaveAttribute("aria-label", "New session in Local E2E");

  await newSession.click();
  await expect(page.locator("#mTitle")).toHaveText("New session in Local E2E");
  await expect(page.locator("#mBody .m-path").first()).toHaveText("/workspace");

  const opened = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/open-session"
  );
  await page.getByRole("button", { name: "Start session here" }).click();
  const response = await opened;
  expect(response.ok()).toBe(true);
  expect(await response.request().headerValue("x-oyster-workspace")).toBe("local");
  await expect(page.locator(".toast", { hasText: "folder: /workspace" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oyster_hub_workspace"))).toBe("local");
  for (let attempt = 0; attempt < 3 && !(await page.locator("#sessions").isVisible()); attempt += 1) {
    await swipe(page, "right");
  }

  await expect(workspaceContainer.locator(".session-sidebar-cwd-label").first()).toHaveText("/workspace");
});
