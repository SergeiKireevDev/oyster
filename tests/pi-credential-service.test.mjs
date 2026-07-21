import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPiCredentialService, resolveConfiguredPiSdk } from "../pi-credential-service.mjs";

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
