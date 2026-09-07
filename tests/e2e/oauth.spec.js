import { test, expect } from "@playwright/test";
import { api, dexec, login, MOBILE_VIEWPORT } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const PROVIDER = "anthropic";

async function restartCurrentRunner() {
  const result = await api("POST", "/restart");
  expect(result.status, result.json.error).toBe(202);
}

function writeMockOAuth(present, generation = 1) {
  // Real Anthropic login stores one grant for both harnesses. Seed both
  // copies immediately, rather than depending on the 60-second upkeep timer.
  const script = `
    import fs from 'node:fs';
    import { createClaudeOAuthCredentialSink } from '/app/server/claude-oauth-credential-sink.mjs';
    const sink = createClaudeOAuthCredentialSink({ configDir: '/home/node/.claude' });
    const path = '/home/node/.pi/agent/auth.json';
    let credentials = {};
    try { credentials = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
    if (${present}) {
      credentials.anthropic = {
        type: 'oauth', access: 'e2e-access-token-${generation}-canary',
        refresh: 'e2e-refresh-token-${generation}-canary', expires: Date.now() + 3600000,
      };
      sink.project(credentials.anthropic);
    } else {
      delete credentials.anthropic;
      sink.remove();
    }
    fs.writeFileSync(path, JSON.stringify(credentials), { mode: 0o600 });
  `;
  dexec(`node --input-type=module -e ${JSON.stringify(script.replace(/\n/g, " "))}`);
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
  let completionReadyAt = 0;
  const recordingDelay = Number(process.env.E2E_ACTION_DELAY_MS ?? 0);
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
    completionReadyAt = 0;
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
    completionReadyAt = Date.now() + (recordingDelay > 0 ? recordingDelay * 2 + 500 : 0);
    return fulfill(route, { flow }, 202);
  });
  await page.route("**/oauth/status", async (route) => {
    if (!autoComplete || Date.now() < completionReadyAt) return fulfill(route, { flow });
    signedIn = true;
    generation += 1;
    writeMockOAuth(true, generation);
    await restartCurrentRunner();
    // /restart is only an acknowledgement. Do not advertise completion while
    // its delayed replacement can still overlap the next re-auth or logout.
    await expectAnthropicAvailability(page, true);
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
    // Only provider authorization is mocked. Exercise real logout so both
    // stores are cleared under the credential lock before runners restart.
    // Deleting auth.json alone lets upkeep restore pi's grant from Claude.
    const response = await route.fetch();
    const body = await response.json();
    expect(response.status(), body.error).toBe(200);
    signedIn = false;
    return fulfill(route, body);
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
  const storedGrant = dexec(`node -e ${JSON.stringify(`
    const fs = require('fs');
    const pi = JSON.parse(fs.readFileSync('/home/node/.pi/agent/auth.json', 'utf8'));
    const claude = JSON.parse(fs.readFileSync('/home/node/.claude/.credentials.json', 'utf8'));
    console.log(Boolean(pi.anthropic || claude.claudeAiOauth));
  `.replace(/\n/g, " "))}`);
  expect(storedGrant, "sign-out must clear both copies so upkeep cannot restore the grant").toBe("false");
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
