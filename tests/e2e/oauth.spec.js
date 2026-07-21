import { test, expect } from "@playwright/test";
import { api, dexec, login, MOBILE_VIEWPORT } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const PROVIDER = "anthropic";
const FLOW_ID = "a".repeat(64);
const SELECT_ID = "b".repeat(64);
const MANUAL_ID = "c".repeat(64);

async function restartCurrentRunner() {
  const result = await api("POST", "/restart");
  expect(result.status, result.json.error).toBe(202);
}

function writeMockOAuth(present, generation = 1) {
  const script = present
    ? `const fs=require('fs');const p='/root/.pi/agent/auth.json';let v={};try{v=JSON.parse(fs.readFileSync(p,'utf8'))}catch{};v.anthropic={type:'oauth',access:'e2e-access-token-${generation}-canary',refresh:'e2e-refresh-token-${generation}-canary',expires:Date.now()+3600000};fs.writeFileSync(p,JSON.stringify(v),{mode:0o600})`
    : `const fs=require('fs');const p='/root/.pi/agent/auth.json';let v={};try{v=JSON.parse(fs.readFileSync(p,'utf8'))}catch{};delete v.anthropic;fs.writeFileSync(p,JSON.stringify(v),{mode:0o600})`;
  dexec(`node -e ${JSON.stringify(script)}`);
}

async function expectAnthropicAvailability(page, expected) {
  await expect.poll(async () => {
    try {
      const result = await page.evaluate(() => window.rpc({ type: "get_available_models" }));
      return result.models?.some((model) => model.provider === "anthropic") ?? false;
    } catch { return !expected; }
  }, { timeout: 30000 }).toBe(expected);
}

async function installMockOAuthRoutes(page) {
  let signedIn = false;
  let generation = 0;
  let flow = null;
  const responseBodies = [];

  const fulfill = async (route, body, status = 200) => {
    responseBodies.push(JSON.stringify(body));
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  };
  await page.route("**/api-keys", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return fulfill(route, { providers: [{
      provider: PROVIDER,
      displayName: "Anthropic",
      oauthDisplayName: "Anthropic (Mock OAuth)",
      oauthCapable: true,
      registered: true,
      credentialType: signedIn ? "oauth" : null,
      source: signedIn ? "stored_oauth" : "not_configured",
      configured: signedIn,
    }] });
  });
  await page.route("**/oauth/start", async (route) => {
    flow = {
      flowId: FLOW_ID, provider: PROVIDER, status: "pending", phase: "select", createdAt: 1, updatedAt: 1,
      authorization: { url: "https://auth.invalid/mock", instructions: "Complete mock browser authorization" },
      deviceCode: { userCode: "MOCK-DEVICE-CODE", verificationUri: "https://auth.invalid/device", expiresInSeconds: 900 },
      requests: [{
        requestId: SELECT_ID, kind: "select", message: "Choose mock sign-in method",
        options: [{ id: "manual", label: "Manual callback" }, { id: "device", label: "Device code" }],
      }],
    };
    return fulfill(route, { flow }, 202);
  });
  await page.route("**/oauth/respond", async (route) => {
    const body = route.request().postDataJSON();
    if (body.requestId === SELECT_ID) {
      flow = {
        ...flow, phase: "manual_code",
        requests: [{ requestId: MANUAL_ID, kind: "manual_code", message: "Paste mock redirect", placeholder: "http://localhost/callback" }],
      };
      return fulfill(route, { flow }, 202);
    }
    signedIn = true;
    generation += 1;
    writeMockOAuth(true, generation);
    await restartCurrentRunner();
    flow = { ...flow, phase: "waiting", requests: [] };
    return fulfill(route, { flow }, 202);
  });
  await page.route("**/oauth/status", async (route) => {
    flow = {
      flowId: FLOW_ID, provider: PROVIDER, status: "succeeded", phase: "complete", createdAt: 1, updatedAt: 2,
      restart: { status: "restarted", runnerIds: ["mock-runner"] },
    };
    return fulfill(route, { flow });
  });
  await page.route("**/oauth/cancel", async (route) => {
    flow = { flowId: FLOW_ID, provider: PROVIDER, status: "cancelled", phase: "complete", failureCode: "oauth_cancelled" };
    return fulfill(route, { flow });
  });
  await page.route("**/oauth", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    signedIn = false;
    writeMockOAuth(false);
    await restartCurrentRunner();
    return fulfill(route, {
      credential: { provider: PROVIDER, removed: true }, source: "not_configured", upstreamRevoked: false,
      restart: { status: "restarted", runnerIds: ["mock-runner"] },
    });
  });
  return { responseBodies, isSignedIn: () => signedIn };
}

async function runOAuthFlow(page) {
  test.setTimeout(180000);
  writeMockOAuth(false);
  const mock = await installMockOAuthRoutes(page);
  await login(page);
  await expectAnthropicAvailability(page, false);

  // Empty auth.json opens credential setup automatically, without navigating.
  await expect(page.locator("#mTitle")).toHaveText("Set up credentials");
  const row = page.locator(`.api-key-row[data-provider="${PROVIDER}"]`);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#mTitle")).toContainText("Sign in to Anthropic");
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await expect(page.getByRole("link", { name: "Open authorization page" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Device code")).toHaveValue("MOCK-DEVICE-CODE");
  await page.getByRole("button", { name: "Manual callback" }).click();
  const manual = page.locator('input[name="oauthResponse"]');
  await manual.fill("http://localhost/callback?code=e2e-manual-code-canary");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Sign-in completed.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Pi restart: restarted")).toBeVisible();
  await expectAnthropicAvailability(page, true);
  await expect(row.getByRole("button", { name: "Re-authenticate" })).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain("e2e-manual-code-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-1-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-refresh-token-1-canary");

  // Re-authenticate successfully, replacing the first mock token without
  // exposing either credential in the page or response bodies.
  await row.getByRole("button", { name: "Re-authenticate" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await page.getByRole("button", { name: "Manual callback" }).click();
  await page.locator('input[name="oauthResponse"]').fill("http://localhost/callback?code=e2e-second-code-canary");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Sign-in completed.")).toBeVisible({ timeout: 15000 });
  expect(await page.locator("body").textContent()).not.toContain("e2e-second-code-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-1-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-2-canary");

  // A subsequent re-authentication can be cancelled without replacing it.
  await row.getByRole("button", { name: "Re-authenticate" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(page.getByText("Sign-in cancelled.")).toBeVisible();
  expect(mock.isSignedIn()).toBe(true);

  await row.getByRole("button", { name: "Sign out from pi" }).click();
  await expect(page.locator("#mBody")).toContainText("does not revoke access at the provider");
  await page.getByRole("button", { name: "Yes" }).click();
  await expectAnthropicAvailability(page, false);
  expect(mock.isSignedIn()).toBe(false);
  expect(dexec("grep -F e2e-access-token- /root/.pi/agent/auth.json >/dev/null; echo $? ")).not.toBe("0");
  const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(browserStorage).not.toContain("e2e-manual-code-canary");
  expect(browserStorage).not.toContain("e2e-access-token-");
}

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => teardownContainer());

test("desktop Credentials OAuth flow signs in, cancels re-authentication, and signs out", async ({ page }) => {
  await runOAuthFlow(page);
});

test("mobile Credentials OAuth flow signs in, cancels re-authentication, and signs out", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await runOAuthFlow(page);
});
