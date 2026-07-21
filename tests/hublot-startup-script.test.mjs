import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  hublotAgentPrompt, invokeHublotStartupScript, materializeHublotStartupScript,
  reserveHublot, validateAndStoreHublotStartupScript,
} from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-script-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

function reserve(state, port = 4173) {
  return reserveHublot(state, { port, brief: "serve the preview" });
}

function writeScript(path, content, mode = 0o755) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
}

test("setup-agent contract names the allocated idempotent script and requires invoking it", (t) => {
  const { state } = fixture(t);
  const hublot = reserve(state);
  const prompt = hublotAgentPrompt({
    id: hublot.id,
    port: hublot.port,
    serviceStartScriptPath: hublot.service_start_script_path,
  }, hublot.brief);
  assert.match(prompt, new RegExp(hublot.service_start_script_path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /idempotent executable startup script/);
  assert.match(prompt, /Invoke that exact script/);
  assert.match(prompt, /do not start the service by any other command/);
  assert.match(prompt, new RegExp(`port ${hublot.port}`));
});

test("validated startup source and SHA-256 become authoritative in SQLite", (t) => {
  const { store, state } = fixture(t);
  const hublot = reserve(state);
  const script = "#!/bin/sh\n# pi-lot-ui: idempotent\n# Return when healthy; otherwise start detached.\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);

  const validated = validateAndStoreHublotStartupScript(state, {
    id: hublot.id,
    serviceStartScriptPath: hublot.service_start_script_path,
  });

  const sha256 = createHash("sha256").update(script).digest("hex");
  assert.deepEqual(validated, { path: hublot.service_start_script_path, content: script, sha256 });
  const persisted = store.repositories.hublots.find(hublot.id);
  assert.equal(persisted.service_start_script, script);
  assert.equal(persisted.service_start_script_sha256, sha256);
});

test("missing and mismatched startup artifacts are atomically restored before invocation", (t) => {
  const { root, state } = fixture(t);
  const hublot = reserve(state);
  const script = "#!/bin/sh\n# pi-lot-ui: idempotent\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);
  validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });

  rmSync(hublot.service_start_script_path);
  const restored = materializeHublotStartupScript(state, hublot.id);
  assert.equal(restored.rematerialized, true);
  assert.equal(readFileSync(restored.path, "utf8"), script);
  assert.equal(lstatSync(restored.path).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(root, "agent", "hublots")).mode & 0o777, 0o700);

  writeFileSync(restored.path, "#!/bin/sh\necho tampered\n", { mode: 0o755 });
  let observedAtInvoke = null;
  const invoked = invokeHublotStartupScript(state, hublot.id, {
    spawnProcess(path) {
      observedAtInvoke = readFileSync(path, "utf8");
      return { pid: 1234 };
    },
  });
  assert.equal(invoked.rematerialized, true);
  assert.equal(observedAtInvoke, script);
  assert.deepEqual(invoked.proc, { pid: 1234 });
  assert.equal(materializeHublotStartupScript(state, hublot.id).rematerialized, false);
});

test("a missing startup script is rematerialized from SQLite contents and hash after restart", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-script-restart-"));
  const databasePath = join(root, "app.sqlite");
  const agentDir = join(root, "agent");
  let store = openAppStore({ databasePath });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  let state = { appStore: store, config: { PI_AGENT_DIR: agentDir }, currentDir: root };
  const hublot = reserve(state);
  const script = "#!/bin/sh\n# pi-lot-ui: idempotent\necho restored\n";
  const sha256 = createHash("sha256").update(script).digest("hex");
  writeScript(hublot.service_start_script_path, script);
  validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });
  rmSync(hublot.service_start_script_path);
  store.close();

  store = openAppStore({ databasePath });
  state = { appStore: store, config: { PI_AGENT_DIR: agentDir }, currentDir: root };
  let invokedContent = null;
  const invoked = invokeHublotStartupScript(state, hublot.id, {
    spawnProcess(path) {
      invokedContent = readFileSync(path, "utf8");
      return { pid: 4321 };
    },
  });

  assert.equal(invoked.rematerialized, true);
  assert.equal(invoked.sha256, sha256);
  assert.equal(invokedContent, script);
  assert.equal(readFileSync(hublot.service_start_script_path, "utf8"), script);
  assert.equal(lstatSync(hublot.service_start_script_path).mode & 0o777, 0o700);
  const persisted = store.repositories.hublots.find(hublot.id);
  assert.equal(persisted.service_start_script, script);
  assert.equal(persisted.service_start_script_sha256, sha256);
});

test("rematerialization replaces symlinks without changing their targets", (t) => {
  const { root, state } = fixture(t);
  const hublot = reserve(state);
  const script = "#!/bin/sh\n# pi-lot-ui: idempotent\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);
  validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });
  const victim = join(root, "victim.sh");
  writeScript(victim, "victim", 0o700);
  rmSync(hublot.service_start_script_path);
  symlinkSync(victim, hublot.service_start_script_path);

  assert.equal(materializeHublotStartupScript(state, hublot.id).rematerialized, true);
  assert.equal(lstatSync(hublot.service_start_script_path).isSymbolicLink(), false);
  assert.equal(readFileSync(hublot.service_start_script_path, "utf8"), script);
  assert.equal(readFileSync(victim, "utf8"), "victim");
});

test("startup validation rejects unsafe or non-protocol artifacts without persisting them", (t) => {
  const { root, store, state } = fixture(t);

  const nonExecutable = reserve(state, 4174);
  writeScript(nonExecutable.service_start_script_path, "#!/bin/sh\n# pi-lot-ui: idempotent\n", 0o600);
  assert.throws(() => validateAndStoreHublotStartupScript(state, {
    id: nonExecutable.id, serviceStartScriptPath: nonExecutable.service_start_script_path,
  }), /not executable/);

  const nonIdempotent = reserve(state, 4175);
  writeScript(nonIdempotent.service_start_script_path, "#!/bin/sh\nexit 0\n");
  assert.throws(() => validateAndStoreHublotStartupScript(state, {
    id: nonIdempotent.id, serviceStartScriptPath: nonIdempotent.service_start_script_path,
  }), /idempotent hublot protocol/);

  const linked = reserve(state, 4176);
  const outside = join(root, "outside.sh");
  writeScript(outside, "#!/bin/sh\n# pi-lot-ui: idempotent\n");
  mkdirSync(dirname(linked.service_start_script_path), { recursive: true });
  symlinkSync(outside, linked.service_start_script_path);
  assert.throws(() => validateAndStoreHublotStartupScript(state, {
    id: linked.id, serviceStartScriptPath: linked.service_start_script_path,
  }), /invalid hublot startup script/);

  for (const id of [nonExecutable.id, nonIdempotent.id, linked.id]) {
    assert.equal(store.repositories.hublots.find(id).service_start_script, null);
    assert.equal(store.repositories.hublots.find(id).service_start_script_sha256, null);
  }
});
