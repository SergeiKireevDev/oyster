import { test, expect } from "@playwright/test";
import { api, dexec, login, MOBILE_VIEWPORT } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const PROVIDER = "anthropic";

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
  let flowSequence = 0;
  let flow = null;
  let selectRequestId = null;
  let autoComplete = true;
  const responseBodies = [];
  const oauthResponses = [];

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
    flowSequence += 1;
    const suffix = flowSequence.toString(16);
    const flowId = `${"a".repeat(64 - suffix.length)}${suffix}`;
    selectRequestId = `${"b".repeat(64 - suffix.length)}${suffix}`;
    flow = {
      flowId, provider: PROVIDER, status: "pending", phase: "select", createdAt: flowSequence, updatedAt: flowSequence,
      authorization: { url: "https://auth.invalid/mock", instructions: "Complete mock browser authorization" },
      requests: [{
        requestId: selectRequestId, kind: "select", message: "Choose mock sign-in method",
        options: [{ id: "manual", label: "Manual callback" }, { id: "device", label: "Device code" }],
      }],
    };
    return fulfill(route, { flow }, 202);
  });
  await page.route("**/oauth/respond", async (route) => {
    const body = route.request().postDataJSON();
    oauthResponses.push(body);
    expect(body).toEqual({ flowId: flow.flowId, requestId: selectRequestId, value: "device" });
    flow = {
      ...flow,
      phase: "device_code",
      deviceCode: { userCode: "MOCK-DEVICE-CODE", verificationUri: "https://auth.invalid/device", expiresInSeconds: 900 },
      requests: [],
    };
    return fulfill(route, { flow }, 202);
  });
  await page.route("**/oauth/status", async (route) => {
    if (!autoComplete) return fulfill(route, { flow });
    signedIn = true;
    generation += 1;
    writeMockOAuth(true, generation);
    await restartCurrentRunner();
    flow = {
      ...flow, status: "succeeded", phase: "complete", updatedAt: flow.updatedAt + 1,
      deviceCode: undefined,
      restart: { status: "restarted", runnerIds: ["mock-runner"] },
    };
    return fulfill(route, { flow });
  });
  await page.route("**/oauth/cancel", async (route) => {
    flow = { ...flow, status: "cancelled", phase: "complete", failureCode: "oauth_cancelled", requests: [], deviceCode: undefined };
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
  return {
    responseBodies,
    oauthResponses,
    isSignedIn: () => signedIn,
    generation: () => generation,
    holdCompletion: () => { autoComplete = false; },
  };
}

async function runOAuthFlow(page) {
  test.setTimeout(180000);
  writeMockOAuth(false);
  const mock = await installMockOAuthRoutes(page);
  await login(page, { keepCredentialSetup: true });
  await expectAnthropicAvailability(page, false);

  // Empty auth.json opens credential setup automatically, without navigating.
  await expect(page.locator("#mTitle")).toHaveText("Set up credentials");
  const row = page.locator(`.api-key-row[data-provider="${PROVIDER}"]`);
  await expect(row).toHaveCount(0);
  await page.getByLabel("Provider").selectOption(PROVIDER);
  await page.getByRole("button", { name: "Sign in with OAuth" }).click();
  await expect(page.locator("#mTitle")).toContainText("Sign in to Anthropic");
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await expect(page.getByRole("link", { name: "Open authorization page" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Device code")).toHaveValue("MOCK-DEVICE-CODE");
  await expect(page.getByRole("button", { name: "Manual callback" })).toHaveCount(0);
  await expect(page.getByText("Sign-in completed.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Pi restart: restarted")).toBeVisible();
  await expect.poll(mock.generation).toBe(1);
  expect(mock.oauthResponses[0]?.value).toBe("device");
  await expectAnthropicAvailability(page, true);
  await expect(row.getByRole("button", { name: "Re-authenticate" })).toBeVisible();
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-1-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-refresh-token-1-canary");

  // Re-authenticate successfully through the automatically selected device-code
  // flow, replacing the first mock token without exposing either credential.
  await row.getByRole("button", { name: "Re-authenticate" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await expect(page.getByLabel("Device code")).toHaveValue("MOCK-DEVICE-CODE");
  await expect(page.getByText("Sign-in completed.")).toBeVisible({ timeout: 15000 });
  await expect.poll(mock.generation).toBe(2);
  expect(mock.oauthResponses[1]?.value).toBe("device");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-1-canary");
  expect(mock.responseBodies.join("\n")).not.toContain("e2e-access-token-2-canary");

  // A subsequent re-authentication can be cancelled without replacing it.
  mock.holdCompletion();
  await row.getByRole("button", { name: "Re-authenticate" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await expect(page.getByLabel("Device code")).toHaveValue("MOCK-DEVICE-CODE");
  expect(mock.oauthResponses[2]?.value).toBe("device");
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
