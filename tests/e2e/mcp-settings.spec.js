import { test, expect } from "@playwright/test";
import { api, login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => teardownContainer());

test("credentials adds, replaces and removes an MCP server without returning secrets", async ({ page }) => {
  await login(page);
  await page.locator("#menuBtn").click();
  await page.locator('#menu button[data-action="credentials"]').click();
  const section = page.getByRole("region", { name: "MCP servers", exact: true });
  await expect(section.getByText("No MCP servers added.")).toBeVisible();
  await section.getByLabel("Name", { exact: true }).fill("example");
  await section.getByLabel("Server URL").fill("https://example.com/mcp");
  await section.getByLabel("Headers (optional JSON object)").fill('{"Authorization":"Bearer test-mcp-secret"}');
  await section.getByRole("button", { name: "Save MCP server" }).click();
  await expect(section.getByRole("status")).toContainText("MCP server saved");
  expect((await api("GET", "/mcp-servers")).json).toEqual({ servers: [{ name: "example", type: "http" }] });
  await expect(section.getByLabel("Headers (optional JSON object)")).toHaveValue("");
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
