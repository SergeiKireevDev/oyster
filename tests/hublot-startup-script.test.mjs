import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { hublotAgentPrompt, reserveHublot, validateAndStoreHublotStartupScript } from "../tunnels.mjs";

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
