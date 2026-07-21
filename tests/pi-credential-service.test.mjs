import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPiCredentialService, resolveConfiguredPiSdk } from "../pi-credential-service.mjs";

const LOCAL_PI = "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";

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

  try {
    const service = createPiCredentialService({ config: { PI_BIN: LOCAL_PI, PI_AGENT_DIR: agentDir } });
    assert.deepEqual(await service.listStoredCredentials(), [
      { provider: "alpha", credentialType: "api_key" },
      { provider: "oauth", credentialType: "oauth" },
      { provider: "untouched", credentialType: "api_key" },
    ]);
    assert.doesNotMatch(JSON.stringify(await service.listStoredCredentials()), /canary|private/);

    await service.setApiKey("alpha", "alpha-new-canary");

    const sdk = await import("file:///home/ubuntu/pi-coding-agent/packages/coding-agent/dist/index.js");
    const concurrentStorage = sdk.AuthStorage.create(authPath);
    concurrentStorage.set("refreshed-oauth", { type: "oauth", access: "fresh-access", refresh: "fresh-refresh", expires: 99 });
    await service.setApiKey("added", "added-canary");

    let stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.deepEqual(stored.alpha, { type: "api_key", key: "alpha-new-canary", env: { REGION: "private" } });
    assert.deepEqual(stored.oauth, oauth);
    assert.equal(stored.untouched.key, "untouched-canary");
    assert.equal(stored.added.key, "added-canary");
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

test("credential operations create auth.json as 0600 and fail closed on malformed storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-credential-malformed-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  try {
    const service = createPiCredentialService({ config: { PI_BIN: LOCAL_PI, PI_AGENT_DIR: agentDir } });
    await service.setApiKey("alpha", "create-canary");
    const authPath = join(agentDir, "auth.json");
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    writeFileSync(authPath, '{"alpha":');
    await assert.rejects(
      service.listStoredCredentials(),
      (error) => error.code === "credential_service_unavailable"
        && error.message === "configured pi auth storage could not be loaded"
        && !error.message.includes("create-canary"),
    );
    await assert.rejects(service.setApiKey("beta", "other-canary"), { code: "credential_service_unavailable" });
    assert.equal(readFileSync(authPath, "utf8"), '{"alpha":');
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
