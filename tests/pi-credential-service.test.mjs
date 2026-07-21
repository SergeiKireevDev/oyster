import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPiCredentialService, resolveConfiguredPiSdk } from "../pi-credential-service.mjs";

const LOCAL_PI = process.env.PI_BIN ?? "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";

function fixture({ sdkSource, manifest = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-credential-service-"));
  const packageRoot = join(root, "pi-package");
  const dist = join(packageRoot, "dist");
  const agentDir = join(root, "agent");
  mkdirSync(dist, { recursive: true });
  mkdirSync(agentDir);
  const cli = join(dist, "cli.js");
  writeFileSync(cli, "#!/usr/bin/env node\n");
  chmodSync(cli, 0o755);
  writeFileSync(join(dist, "index.js"), sdkSource ?? `
    export class AuthStorage {
      static create(path) { return { kind: "auth", path }; }
    }
    export class ModelRegistry {
      static create(authStorage, path) { return { kind: "models", authStorage, path }; }
    }
  `);
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "fixture-pi",
    type: "module",
    bin: { pi: "dist/cli.js" },
    exports: { ".": { import: "./dist/index.js" } },
    ...manifest,
  }));
  return { root, packageRoot, cli, agentDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("credential service imports the SDK owned by the real configured PI_BIN", async () => {
  const item = fixture();
  try {
    const linkedBin = join(item.root, "pi-link");
    symlinkSync(item.cli, linkedBin);
    const location = resolveConfiguredPiSdk(linkedBin);
    assert.equal(location.packageRoot, item.packageRoot);
    assert.equal(location.entry, join(item.packageRoot, "dist", "index.js"));

    const adapter = await createPiCredentialService({
      config: { PI_BIN: linkedBin, PI_AGENT_DIR: item.agentDir },
    }).load();
    assert.deepEqual(adapter.authStorage, { kind: "auth", path: join(item.agentDir, "auth.json") });
    assert.deepEqual(adapter.modelRegistry, {
      kind: "models",
      authStorage: adapter.authStorage,
      path: join(item.agentDir, "models.json"),
    });
    assert.equal(adapter.sdkEntry, join(item.packageRoot, "dist", "index.js"));
  } finally {
    item.cleanup();
  }
});

test("credential service rejects an SDK without pi credential exports", async () => {
  const item = fixture({ sdkSource: "export const unrelated = true;\n" });
  try {
    await assert.rejects(
      createPiCredentialService({ config: { PI_BIN: item.cli, PI_AGENT_DIR: item.agentDir } }).load(),
      (error) => error.code === "credential_service_unavailable"
        && error.message.includes("does not export AuthStorage and ModelRegistry")
        && error.message.includes(join(item.packageRoot, "dist", "index.js")),
    );
  } finally {
    item.cleanup();
  }
});

test("credential service does not fall back when PI_BIN has no owning SDK package", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-no-sdk-"));
  try {
    const cli = join(root, "pi");
    const agentDir = join(root, "agent");
    writeFileSync(cli, "#!/usr/bin/env node\n");
    mkdirSync(agentDir);
    await assert.rejects(
      createPiCredentialService({ config: { PI_BIN: cli, PI_AGENT_DIR: agentDir } }).load(),
      (error) => error.code === "credential_service_unavailable"
        && error.message.includes("not owned by a package exposing its SDK")
        && error.message.includes(cli),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("credential operations preserve unrelated credentials, provider env, concurrent updates, and file mode", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-credential-operations-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  const authPath = join(agentDir, "auth.json");
  const oauth = { type: "oauth", access: "oauth-access-canary", refresh: "oauth-refresh-canary", expires: 42 };
  writeFileSync(authPath, JSON.stringify({
    alpha: { type: "api_key", key: "alpha-old-canary", env: { REGION: "private" } },
    oauth,
    untouched: { type: "api_key", key: "untouched-canary" },
  }), { mode: 0o600 });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
    "custom-safe": {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      apiKey: "models-json-canary",
      models: [{
        id: "custom-model", name: "Custom Model", reasoning: false, input: ["text"],
        contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    },
  } }));

  try {
    const service = createPiCredentialService({ config: { PI_BIN: LOCAL_PI, PI_AGENT_DIR: agentDir } });
    assert.deepEqual(await service.listStoredCredentials(), [
      { provider: "alpha", credentialType: "api_key" },
      { provider: "oauth", credentialType: "oauth" },
      { provider: "untouched", credentialType: "api_key" },
    ]);
    assert.doesNotMatch(JSON.stringify(await service.listStoredCredentials()), /canary|private/);

    const providers = await service.listProviders();
    assert.deepEqual(providers.find((item) => item.provider === "alpha"), {
      provider: "alpha", displayName: "alpha", registered: false,
      oauthCapable: false, oauthDisplayName: null,
      credentialType: "api_key", source: "stored_api_key", configured: true,
    });
    assert.deepEqual(providers.find((item) => item.provider === "custom-safe"), {
      provider: "custom-safe", displayName: "custom-safe", registered: true,
      oauthCapable: false, oauthDisplayName: null,
      credentialType: null, source: "models_json", configured: true,
    });
    assert.deepEqual(providers.find((item) => item.provider === "oauth"), {
      provider: "oauth", displayName: "oauth", registered: false,
      oauthCapable: false, oauthDisplayName: null,
      credentialType: "oauth", source: "stored_oauth", configured: true,
    });
    assert.equal(providers.find((item) => item.provider === "openai").displayName, "OpenAI");
    const anthropic = providers.find((item) => item.provider === "anthropic");
    assert.equal(anthropic.oauthCapable, true);
    assert.equal(anthropic.oauthDisplayName, "Anthropic (Claude Pro/Max)");
    assert.doesNotMatch(JSON.stringify(providers), /canary|private|REGION/);
    await assert.rejects(service.setApiKey("not-registered", "must-not-write"), { code: "unknown_provider" });
    await service.setApiKey("custom-safe", "custom-stored-canary");
    await service.removeApiKey("custom-safe");

    // Existing orphaned providers remain replaceable even though new unknown
    // provider IDs are rejected.
    await service.setApiKey("alpha", "alpha-new-canary");

    const sdk = await import(pathToFileURL(resolveConfiguredPiSdk(LOCAL_PI).entry).href);
    const concurrentStorage = sdk.AuthStorage.create(authPath);
    concurrentStorage.set("refreshed-oauth", { type: "oauth", access: "fresh-access", refresh: "fresh-refresh", expires: 99 });
    await service.setApiKey("openai", "added-canary");

    let stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.deepEqual(stored.alpha, { type: "api_key", key: "alpha-new-canary", env: { REGION: "private" } });
    assert.deepEqual(stored.oauth, oauth);
    assert.equal(stored.untouched.key, "untouched-canary");
    assert.equal(stored.openai.key, "added-canary");
    assert.equal(stored["refreshed-oauth"].refresh, "fresh-refresh");
    assert.equal(statSync(authPath).mode & 0o777, 0o600);

    await assert.rejects(service.setApiKey("oauth", "must-not-write"), { code: "oauth_conflict" });
    await assert.rejects(service.removeApiKey("oauth"), { code: "oauth_conflict" });
    await service.removeApiKey("alpha");
    stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.equal(stored.alpha, undefined);
    assert.deepEqual(stored.oauth, oauth);
    assert.equal(stored.untouched.key, "untouched-canary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OAuth adapter forwards Pi callbacks, protects credential types, and preserves failed logins", async () => {
  const item = fixture({ sdkSource: `
    import { readFileSync, writeFileSync } from "node:fs";
    const providers = [
      {
        id: "mock-oauth", name: "Mock OAuth",
        async login(callbacks) {
          callbacks.onAuth({ url: "https://auth.invalid/start", instructions: "Continue" });
          callbacks.onDeviceCode({ userCode: "DEVICE-CODE", verificationUri: "https://auth.invalid/device" });
          callbacks.onProgress?.("Waiting");
          const prompt = await callbacks.onPrompt({ message: "Prompt" });
          const selected = await callbacks.onSelect({ message: "Choose", options: [{ id: "one", label: "One" }] });
          const manual = await callbacks.onManualCodeInput?.();
          return { refresh: "refresh-" + prompt, access: "access-" + selected + "-" + manual, expires: 42 };
        },
        async refreshToken(value) { return value; },
        getApiKey(value) { return value.access; },
      },
      {
        id: "failed-oauth", name: "Failed OAuth",
        async login(callbacks) { callbacks.onProgress?.("Failing"); throw new Error("provider failed"); },
        async refreshToken(value) { return value; },
        getApiKey(value) { return value.access; },
      },
    ];
    export class AuthStorage {
      static create(path) { return new AuthStorage(path); }
      constructor(path) { this.path = path; this.data = {}; this.reload(); }
      reload() { try { this.data = JSON.parse(readFileSync(this.path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; this.data = {}; } }
      drainErrors() { return []; }
      list() { return Object.keys(this.data); }
      get(id) { return this.data[id]; }
      getOAuthProviders() { return providers; }
      set(id, value) { this.data = { ...this.data, [id]: { type: value.type ?? "oauth", ...value } }; writeFileSync(this.path, JSON.stringify(this.data), { mode: 0o600 }); }
      remove(id) { const next = { ...this.data }; delete next[id]; this.data = next; writeFileSync(this.path, JSON.stringify(this.data), { mode: 0o600 }); }
      async login(id, callbacks) { const provider = providers.find((item) => item.id === id); this.set(id, { type: "oauth", ...(await provider.login(callbacks)) }); }
      logout(id) { this.remove(id); }
    }
    export class ModelRegistry {
      static create() { return {}; }
    }
  ` });
  const authPath = join(item.agentDir, "auth.json");
  writeFileSync(authPath, JSON.stringify({
    "api-only": { type: "api_key", key: "api-key-canary" },
    "mock-oauth": { type: "api_key", key: "replace-conflict-canary" },
    "failed-oauth": { type: "oauth", access: "old-access", refresh: "old-refresh", expires: 1 },
    "orphan-oauth": { type: "oauth", access: "orphan-access", refresh: "orphan-refresh", expires: 1 },
  }), { mode: 0o600 });

  try {
    const service = createPiCredentialService({ config: { PI_BIN: item.cli, PI_AGENT_DIR: item.agentDir } });
    const callbacks = {
      onAuth() {}, onDeviceCode() {}, async onPrompt() { return ""; }, async onSelect() {},
    };
    await assert.rejects(service.loginOAuth("mock-oauth", callbacks), { code: "credential_replace_required" });
    await service.removeApiKey("mock-oauth");

    const events = [];
    const signal = new AbortController().signal;
    const credential = await service.loginOAuth("mock-oauth", {
      onAuth: (value) => events.push(["auth", value]),
      onDeviceCode: (value) => events.push(["device", value]),
      onProgress: (value) => events.push(["progress", value]),
      onPrompt: async (value) => { events.push(["prompt", value]); return "prompt-answer"; },
      onSelect: async (value) => { events.push(["select", value]); return "one"; },
      onManualCodeInput: async () => { events.push(["manual"]); return "manual-answer"; },
      signal,
    });
    assert.deepEqual(credential, { provider: "mock-oauth", credentialType: "oauth" });
    assert.deepEqual(events.map(([type]) => type), ["auth", "device", "progress", "prompt", "select", "manual"]);
    assert.equal(statSync(authPath).mode & 0o777, 0o600);

    await assert.rejects(service.loginOAuth("unknown", {
      onAuth() {}, onDeviceCode() {}, async onPrompt() { return ""; }, async onSelect() {},
    }), { code: "oauth_provider_not_found" });
    await assert.rejects(service.loginOAuth("api-only", {
      onAuth() {}, onDeviceCode() {}, async onPrompt() { return ""; }, async onSelect() {},
    }), { code: "oauth_provider_not_found" });
    await assert.rejects(service.logoutOAuth("api-only"), { code: "credential_type_conflict" });

    await assert.rejects(service.loginOAuth("failed-oauth", {
      onAuth() {}, onDeviceCode() {}, async onPrompt() { return ""; }, async onSelect() {}, onProgress() {},
    }, { replace: true }), /provider failed/);
    let stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.equal(stored["failed-oauth"].access, "old-access");

    let releasePrompt;
    const pending = service.loginOAuth("mock-oauth", {
      onAuth() {}, onDeviceCode() {}, onPrompt: () => new Promise((resolve) => { releasePrompt = resolve; }),
      async onSelect() { return "one"; }, async onManualCodeInput() { return "manual"; },
    }, { replace: true });
    while (!releasePrompt) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(service.loginOAuth("mock-oauth", {
      onAuth() {}, onDeviceCode() {}, async onPrompt() { return ""; }, async onSelect() {},
    }), { code: "credential_busy" });
    await assert.rejects(service.setApiKey("mock-oauth", "must-not-write"), { code: "credential_busy" });
    await assert.rejects(service.removeApiKey("mock-oauth"), { code: "credential_busy" });
    await assert.rejects(service.logoutOAuth("mock-oauth"), { code: "credential_busy" });
    await service.setApiKey("api-only", "unrelated-replacement-canary");
    releasePrompt("done");
    await pending;
    assert.deepEqual(await service.logoutOAuth("mock-oauth"), { provider: "mock-oauth", removed: true });

    assert.deepEqual(await service.logoutOAuth("orphan-oauth"), { provider: "orphan-oauth", removed: true });
    stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.equal(stored["orphan-oauth"], undefined);
    assert.equal(stored["api-only"].key, "unrelated-replacement-canary");
  } finally {
    item.cleanup();
  }
});

test("credential operations create auth.json as 0600 and fail closed on malformed storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-credential-malformed-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  try {
    const service = createPiCredentialService({ config: { PI_BIN: LOCAL_PI, PI_AGENT_DIR: agentDir } });
    await service.setApiKey("openai", "create-canary");
    const authPath = join(agentDir, "auth.json");
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    writeFileSync(authPath, '{"openai":');
    await assert.rejects(
      service.listStoredCredentials(),
      (error) => error.code === "credential_service_unavailable"
        && error.message === "configured pi auth storage could not be loaded"
        && !error.message.includes("create-canary"),
    );
    await assert.rejects(service.setApiKey("openai", "other-canary"), { code: "credential_service_unavailable" });
    assert.equal(readFileSync(authPath, "utf8"), '{"openai":');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("credential service requires the validated absolute PI_AGENT_DIR", () => {
  assert.throws(
    () => createPiCredentialService({ config: { PI_BIN: process.execPath, PI_AGENT_DIR: "relative-agent" } }),
    (error) => error.code === "credential_service_unavailable"
      && error.message === "validated absolute PI_AGENT_DIR is required for credential support",
  );
  assert.throws(
    () => createPiCredentialService({ config: { PI_BIN: process.execPath, PI_AGENT_DIR: resolve("agent", "..", "agent") + "/.." } }),
    { code: "credential_service_unavailable" },
  );
});
