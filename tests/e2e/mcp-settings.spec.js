import { test, expect } from "@playwright/test";
import { api, login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => teardownContainer());

for (const width of [1400, 390]) test(`credentials validates, adds, replaces and removes MCP servers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await login(page);
  await page.locator("#menuBtn").click();
  await page.locator('#menu button[data-action="credentials"]').click();
  const section = page.getByRole("region", { name: "MCP servers", exact: true });
  await expect(section.getByText("No MCP servers added.")).toBeVisible();
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("alert")).toContainText("Enter a server name");
  await expect(section.getByRole("alert")).toBeFocused();
  await section.getByLabel("Name", { exact: true }).fill("example");
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("alert")).toContainText("complete HTTP or HTTPS server URL");
  await section.getByLabel("Server URL").fill("https://example.com/mcp");
  await section.getByLabel("Header name", { exact: true }).fill("Authorization");
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("alert")).toContainText("Enter a value for header Authorization");
  await section.getByLabel("Header value", { exact: true }).fill("Bearer test-mcp-secret");
  await section.getByRole("button", { name: "Add header", exact: true }).click();
  await section.getByLabel("Header name", { exact: true }).nth(1).fill("X-Workspace");
  await section.getByLabel("Header value", { exact: true }).nth(1).fill("test-workspace");
  const savedRequest = page.waitForRequest((request) => request.url().endsWith("/mcp-servers") && request.method() === "POST");
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("status")).toContainText("MCP server saved");
  expect((await savedRequest).postDataJSON().config.headers).toEqual({ Authorization: "Bearer test-mcp-secret", "X-Workspace": "test-workspace" });
  expect((await api("GET", "/mcp-servers")).json).toEqual({ servers: [{ name: "example", type: "http" }] });
  await expect(section.getByLabel("Header value", { exact: true })).toHaveValue("");
  await section.getByLabel("Name", { exact: true }).fill("example");
  await section.getByLabel("Transport").selectOption("stdio");
  await section.getByLabel("Command", { exact: true }).fill("node");
  await section.getByLabel("Arguments (JSON array)").fill("not json");
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("alert")).toContainText("valid JSON");
  await section.getByLabel("Arguments (JSON array)").fill("[]");
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("status")).toContainText("MCP server saved");
  expect((await api("GET", "/mcp-servers")).json.servers).toEqual([{ name: "example", type: "stdio" }]);
  await section.getByRole("button", { name: "Remove MCP server example" }).click();
  await expect(section.getByText("No MCP servers added.")).toBeVisible();
});

test("MCP credentials scan automatically, retry, and discard results after edits", async ({ page }) => {
  await login(page);
  await page.locator("#menuBtn").click();
  await page.locator('#menu button[data-action="credentials"]').click();
  const section = page.getByRole("region", { name: "MCP servers", exact: true });
  let scans = 0;
  await page.route("**/mcp-servers/test", async (route) => {
    scans++;
    const input = route.request().postDataJSON();
    await route.fulfill({ json: input.config.headers.Authorization === "Bearer good"
      ? { tools: ["example_search", "example_read"], truncated: false }
      : { error: "Authentication rejected. Check the credentials and access permissions." } });
  });
  await section.getByLabel("Name", { exact: true }).fill("scan-test");
  await section.getByLabel("Header name", { exact: true }).fill("Authorization");
  await section.getByLabel("Server URL").fill("https://example.com/mcp");
  await page.waitForTimeout(1200);
  expect(scans).toBe(0);
  await section.getByLabel("Header value", { exact: true }).fill("Bearer bad");
  await expect(section.getByRole("status")).toContainText("Authentication rejected");
  const initialScans = scans;
  await expect.poll(() => scans).toBeGreaterThan(initialScans);
  await section.getByLabel("Header value", { exact: true }).fill("Bearer good");
  await expect(section.getByRole("status")).toContainText("2 tools available");
  await section.locator("summary").click();
  await expect(section.getByText("example_search", { exact: true })).toBeVisible();
  await section.getByLabel("Server URL").fill("");
  await expect(section.getByText("example_search", { exact: true })).toHaveCount(0);
  const stoppedScans = scans;
  await page.waitForTimeout(1200);
  expect(scans).toBe(stoppedScans);
  expect((await api("GET", "/mcp-servers")).json.servers).toEqual([]);
});
