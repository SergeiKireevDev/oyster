import { test, expect } from "@playwright/test";
import { api, dexec, login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const PROVIDER = "secured_mock";
const MODEL_NAME = "Secured Mock";

function installSecuredMockProvider() {
  const config = {
    providers: {
      mock: {
        baseUrl: "http://127.0.0.1:4010/v1", api: "openai-completions", apiKey: "sk-e2e-mock",
        models: [{ id: "e2e-mock", name: "E2E Mock", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
      },
      [PROVIDER]: {
        baseUrl: "http://127.0.0.1:4010/v1", api: "openai-completions",
        models: [{ id: "secured-model", name: MODEL_NAME, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
      },
    },
  };
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64");
  dexec(`printf %s ${encoded} | base64 -d > /root/.pi/agent/models.json`);
}

async function openApiKeys(page, { expectActive = false } = {}) {
  const credentials = page.getByRole("region", { name: "Pi credentials" });
  if (!(await credentials.isVisible().catch(() => false))) {
    await page.locator("#menuBtn").click();
    await page.locator('#menu button[data-action="credentials"]').click();
    await expect(page.locator("#mTitle")).toHaveText("Credentials");
  }
  await expect(credentials).toBeVisible({ timeout: 15000 });
  await expect(credentials.locator(`option[value="${PROVIDER}"]`)).toHaveCount(1);
  if (expectActive) {
    await expect(credentials.locator(`.api-key-row[data-provider="${PROVIDER}"]`)).toBeVisible({ timeout: 15000 });
  }
}

async function confirmYes(page) {
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);
}

async function expectModelAvailability(page, expected) {
  await expect.poll(async () => {
    try {
      const result = await page.evaluate(() => window.rpc({ type: "get_available_models" }));
      return result.models?.some((model) => model.provider === "secured_mock" && model.id === "secured-model") ?? false;
    } catch {
      return !expected;
    }
  }, { timeout: 30000 }).toBe(expected);
}

async function waitForStoredType(type) {
  await expect.poll(async () => {
    const result = await api("GET", "/api-keys");
    return result.json.providers?.find((provider) => provider.provider === PROVIDER)?.credentialType ?? null;
  }, { timeout: 30000 }).toBe(type);
}

test.beforeEach(async () => {
  await ensureContainer();
  installSecuredMockProvider();
});
test.afterEach(() => teardownContainer());

test("API Keys menu adds, replaces, and removes a mock provider key without exposing values", async ({ page }) => {
  test.setTimeout(180000);
  const firstKey = `e2e-first-${Date.now()}`;
  const replacementKey = `e2e-replacement-${Date.now()}`;
  await login(page);
  await expectModelAvailability(page, false);

  await openApiKeys(page);
  await page.locator(".api-key-form select").selectOption(PROVIDER);
  await page.locator('.api-key-form input[type="password"]').fill(firstKey);
  await page.getByRole("button", { name: "Save and restart pi" }).click();
  await expect(page.locator("#mTitle")).toContainText(`Save API key for ${PROVIDER}`);
  await confirmYes(page);
  await waitForStoredType("api_key");
  await expectModelAvailability(page, true);
  expect(await page.locator("body").textContent()).not.toContain(firstKey);

  await openApiKeys(page, { expectActive: true });
  await page.locator(".api-key-form select").selectOption(PROVIDER);
  await page.locator('.api-key-form input[type="password"]').fill(replacementKey);
  await page.getByRole("button", { name: "Replace and restart pi" }).click();
  await expect(page.locator("#mTitle")).toContainText(`Replace API key for ${PROVIDER}`);
  await confirmYes(page);
  await waitForStoredType("api_key");
  expect(await page.locator("body").textContent()).not.toContain(firstKey);
  expect(await page.locator("body").textContent()).not.toContain(replacementKey);

  await openApiKeys(page, { expectActive: true });
  await page.locator(`.api-key-row[data-provider="${PROVIDER}"] .api-key-remove`).click();
  await expect(page.locator("#mTitle")).toContainText(`Remove API key for ${PROVIDER}`);
  await expect(page.locator("#mBody")).toContainText("does not revoke the key at the provider");
  await confirmYes(page);
  await waitForStoredType(null);
  await expectModelAvailability(page, false);
  expect(dexec(`grep -F ${JSON.stringify(firstKey)} /root/.pi/agent/auth.json >/dev/null; echo $?`)).not.toBe("0");
  expect(dexec(`grep -F ${JSON.stringify(replacementKey)} /root/.pi/agent/auth.json >/dev/null; echo $?`)).not.toBe("0");
});
