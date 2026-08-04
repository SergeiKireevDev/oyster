import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  hublotAgentPrompt, invokeHublotStartupScript, markdownReaderScriptPath, materializeHublotStartupScript,
  reserveHublot, spawnGitServerService, spawnHublotAgent, spawnMarkdownService, validateAndStoreHublotStartupScript,
} from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-script-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, state };
}

async function reserve(state, port = 4173) {
  return reserveHublot(state, { port, brief: "serve the preview" });
}

function writeScript(path, content, mode = 0o755) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
}

test("setup-agent contract names the allocated idempotent script and requires invoking it", async (t) => {
  const { state } = await fixture(t);
  const hublot = await reserve(state);
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

test("setup agent waits for its startup artifact when the port already answers", { timeout: 1_000 }, async (t) => {
  const { state } = await fixture(t);
  const hublot = await reserve(state);
  const processOutput = new EventEmitter();
  const agent = new EventEmitter();
  Object.assign(agent, {
    pid: process.pid,
    exitCode: null,
    killed: false,
    stdout: processOutput,
    stderr: processOutput,
    unref() {},
    kill() { this.killed = true; },
  });
  state.piProcesses = { ephemeral: () => agent };

  let reportFirstValidation;
  const firstValidation = new Promise((resolve) => { reportFirstValidation = resolve; });
  let validationAttempts = 0;
  let settled = false;
  const opening = spawnHublotAgent(state, {
    id: hublot.id,
    port: hublot.port,
    serviceStartScriptPath: hublot.service_start_script_path,
  }, hublot.brief, {
    checkPort: async () => true,
    discoverPids: () => [],
    pollIntervalMs: 5,
    async validateStartupScript(...args) {
      validationAttempts += 1;
      try { return await validateAndStoreHublotStartupScript(...args); }
      finally { reportFirstValidation(); }
    },
  });
  opening.then(() => { settled = true; }, () => { settled = true; });

  await firstValidation;
  assert.equal(settled, false, "an answering port alone must not finish setup");
  writeScript(hublot.service_start_script_path, "#!/bin/sh\n# oyster: idempotent\nexit 0\n");
  await opening;
  assert.ok(validationAttempts >= 2);
});

test("setup-agent polling converts rejected health checks into a bounded failure", { timeout: 1_000 }, async (t) => {
  const { state } = await fixture(t);
  const hublot = await reserve(state);
  const output = new EventEmitter();
  const agent = new EventEmitter();
  Object.assign(agent, {
    pid: process.pid,
    exitCode: null,
    killed: false,
    stdout: output,
    stderr: output,
    unref() {},
    kill() { this.killed = true; },
  });
  state.piProcesses = { ephemeral: () => agent };

  await assert.rejects(spawnHublotAgent(state, {
    id: hublot.id,
    port: hublot.port,
    serviceStartScriptPath: hublot.service_start_script_path,
  }, hublot.brief, {
    checkPort: async () => { throw new Error("health probe failed"); },
    pollIntervalMs: 5,
    timeoutMs: 1,
  }), /health probe failed/);
  assert.equal(agent.killed, true);
});

test("setup-agent completion rejects instead of hanging when service discovery fails", { timeout: 1_000 }, async (t) => {
  const { state } = await fixture(t);
  const hublot = await reserve(state);
  writeScript(hublot.service_start_script_path, "#!/bin/sh\n# oyster: idempotent\nexit 0\n");
  const output = new EventEmitter();
  const agent = new EventEmitter();
  Object.assign(agent, {
    pid: process.pid,
    exitCode: null,
    killed: false,
    stdout: output,
    stderr: output,
    unref() {},
    kill() { this.killed = true; },
  });
  state.piProcesses = { ephemeral: () => agent };

  await assert.rejects(spawnHublotAgent(state, {
    id: hublot.id,
    port: hublot.port,
    serviceStartScriptPath: hublot.service_start_script_path,
  }, hublot.brief, {
    checkPort: async () => true,
    discoverPids: () => { throw new Error("lsof failed unexpectedly"); },
    pollIntervalMs: 5,
  }), /lsof failed unexpectedly/);
  assert.equal(agent.killed, true);
});

test("validated startup source and SHA-256 become authoritative in SQLite", async (t) => {
  const { store, state } = await fixture(t);
  const hublot = await reserve(state);
  const script = "#!/bin/sh\n# oyster: idempotent\n# Return when healthy; otherwise start detached.\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);

  const validated = await validateAndStoreHublotStartupScript(state, {
    id: hublot.id,
    serviceStartScriptPath: hublot.service_start_script_path,
  });

  const sha256 = createHash("sha256").update(script).digest("hex");
  assert.deepEqual(validated, { path: hublot.service_start_script_path, content: script, sha256 });
  const persisted = await store.repositories.hublots.find(hublot.id);
  assert.equal(persisted.service_start_script, script);
  assert.equal(persisted.service_start_script_sha256, sha256);
});

test("missing and mismatched startup artifacts are atomically restored before invocation", async (t) => {
  const { root, state } = await fixture(t);
  const hublot = await reserve(state);
  const script = "#!/bin/sh\n# oyster: idempotent\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);
  await validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });

  rmSync(hublot.service_start_script_path);
  const restored = await materializeHublotStartupScript(state, hublot.id);
  assert.equal(restored.rematerialized, true);
  assert.equal(readFileSync(restored.path, "utf8"), script);
  assert.equal(lstatSync(restored.path).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(root, "agent", "hublots")).mode & 0o777, 0o700);

  writeFileSync(restored.path, "#!/bin/sh\necho tampered\n", { mode: 0o755 });
  let observedAtInvoke = null;
  const invoked = await invokeHublotStartupScript(state, hublot.id, {
    spawnProcess(path) {
      observedAtInvoke = readFileSync(path, "utf8");
      return { pid: 1234 };
    },
  });
  assert.equal(invoked.rematerialized, true);
  assert.equal(observedAtInvoke, script);
  assert.deepEqual(invoked.proc, { pid: 1234 });
  assert.equal((await materializeHublotStartupScript(state, hublot.id)).rematerialized, false);
});

test("a missing startup script is rematerialized from SQLite contents and hash after restart", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-script-restart-"));
  const databasePath = join(root, "app.sqlite");
  const agentDir = join(root, "agent");
  let store = await openAppStore({ databasePath });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  let state = { appStore: store, config: { PI_AGENT_DIR: agentDir }, currentDir: root };
  const hublot = await reserve(state);
  const script = "#!/bin/sh\n# oyster: idempotent\necho restored\n";
  const sha256 = createHash("sha256").update(script).digest("hex");
  writeScript(hublot.service_start_script_path, script);
  await validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });
  rmSync(hublot.service_start_script_path);
  await store.close();

  store = await openAppStore({ databasePath });
  state = { appStore: store, config: { PI_AGENT_DIR: agentDir }, currentDir: root };
  let invokedContent = null;
  const invoked = await invokeHublotStartupScript(state, hublot.id, {
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
  const persisted = await store.repositories.hublots.find(hublot.id);
  assert.equal(persisted.service_start_script, script);
  assert.equal(persisted.service_start_script_sha256, sha256);
});

test("rematerialization replaces symlinks without changing their targets", async (t) => {
  const { root, state } = await fixture(t);
  const hublot = await reserve(state);
  const script = "#!/bin/sh\n# oyster: idempotent\nexit 0\n";
  writeScript(hublot.service_start_script_path, script);
  await validateAndStoreHublotStartupScript(state, { id: hublot.id, serviceStartScriptPath: hublot.service_start_script_path });
  const victim = join(root, "victim.sh");
  writeScript(victim, "victim", 0o700);
  rmSync(hublot.service_start_script_path);
  symlinkSync(victim, hublot.service_start_script_path);

  assert.equal((await materializeHublotStartupScript(state, hublot.id)).rematerialized, true);
  assert.equal(lstatSync(hublot.service_start_script_path).isSymbolicLink(), false);
  assert.equal(readFileSync(hublot.service_start_script_path, "utf8"), script);
  assert.equal(readFileSync(victim, "utf8"), "victim");
});

test("default Markdown reader and template are bundled in this repository", () => {
  const rendererPath = markdownReaderScriptPath();
  assert.match(rendererPath, /\/markdown-tool\/markdown-reader\.mjs$/);
  assert.equal(lstatSync(rendererPath).isFile(), true);
  assert.equal(lstatSync(join(dirname(rendererPath), "reader-template.html")).isFile(), true);
});

test("Markdown service invokes the bundled Node.js reader and persists its restart command", async (t) => {
  const { root, store, state } = await fixture(t);
  const markdownPath = join(root, "guide.md");
  const rendererPath = join(root, "markdown-reader.mjs");
  const nodePath = "/runtime/node";
  writeFileSync(markdownPath, "# Guide\n");
  writeFileSync(rendererPath, "export {};\n");
  const hublot = await reserve(state, 4177);
  let invocation = null;
  class FakeProcess extends EventEmitter {
    pid = process.pid;
    exitCode = null;
    unref() {}
    kill() { this.exitCode = 0; }
  }

  const service = await spawnMarkdownService(state, {
    id: hublot.id,
    port: hublot.port,
  }, markdownPath, {
    rendererPath,
    nodePath,
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      return new FakeProcess();
    },
    waitForPort: async () => true,
  });

  assert.equal(service.servicePid, process.pid);
  assert.equal(invocation.command, nodePath);
  assert.deepEqual(invocation.args, [rendererPath, markdownPath, String(hublot.port)]);
  assert.equal(invocation.options.detached, true);
  const persisted = await store.repositories.hublots.find(hublot.id);
  assert.match(persisted.service_start_script, /# oyster: idempotent/);
  assert.match(persisted.service_start_script, new RegExp(nodePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(persisted.service_start_script, new RegExp(rendererPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(persisted.service_start_script, new RegExp(markdownPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(persisted.service_start_script, /python3/);
  assert.equal(readFileSync(hublot.service_start_script_path, "utf8"), persisted.service_start_script);
  assert.equal(await ((await store.repositories.hublots.listProcesses(hublot.id)).find((row) => row.role === "service")).status, "running");
});

test("Git server service directly invokes the bundled script and persists its restart command", async (t) => {
  const { root, store, state } = await fixture(t);
  const worktreePath = join(root, "worktree");
  const serverPath = join(root, "serve-git-smart-http.sh");
  mkdirSync(worktreePath);
  execFileSync("git", ["init", "--quiet", worktreePath]);
  writeScript(serverPath, "#!/bin/sh\nexit 0\n");
  const hublot = await reserve(state, 4178);
  let invocation = null;
  class FakeProcess extends EventEmitter {
    pid = process.pid;
    exitCode = null;
    unref() {}
    kill() { this.exitCode = 0; }
  }

  const service = await spawnGitServerService(state, {
    id: hublot.id,
    port: hublot.port,
  }, worktreePath, {
    serverPath,
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      return new FakeProcess();
    },
    waitForPort: async () => true,
  });

  assert.equal(service.servicePid, process.pid);
  assert.equal(invocation.command, serverPath);
  const gitStateDir = join(dirname(hublot.service_start_script_path), "git-server-state");
  assert.deepEqual(invocation.args, ["--host", "127.0.0.1", "--port", String(hublot.port), "--state-dir", gitStateDir, worktreePath]);
  assert.equal(invocation.options.cwd, worktreePath);
  assert.equal(invocation.options.detached, true);
  const persisted = await store.repositories.hublots.find(hublot.id);
  assert.match(persisted.service_start_script, /# oyster: idempotent/);
  assert.match(persisted.service_start_script, /--host 127\.0\.0\.1 --port 4178 --state-dir/);
  assert.match(persisted.service_start_script, new RegExp(worktreePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(readFileSync(hublot.service_start_script_path, "utf8"), persisted.service_start_script);
  assert.equal(await ((await store.repositories.hublots.listProcesses(hublot.id)).find((row) => row.role === "service")).status, "running");
});

test("startup validation rejects unsafe or non-protocol artifacts without persisting them", async (t) => {
  const { root, store, state } = await fixture(t);

  const nonExecutable = await reserve(state, 4174);
  writeScript(nonExecutable.service_start_script_path, "#!/bin/sh\n# oyster: idempotent\n", 0o600);
  await assert.rejects(() => validateAndStoreHublotStartupScript(state, {
    id: nonExecutable.id, serviceStartScriptPath: nonExecutable.service_start_script_path,
  }), /not executable/);

  const nonIdempotent = await reserve(state, 4175);
  writeScript(nonIdempotent.service_start_script_path, "#!/bin/sh\nexit 0\n");
  await assert.rejects(() => validateAndStoreHublotStartupScript(state, {
    id: nonIdempotent.id, serviceStartScriptPath: nonIdempotent.service_start_script_path,
  }), /idempotent hublot protocol/);

  const linked = await reserve(state, 4176);
  const outside = join(root, "outside.sh");
  writeScript(outside, "#!/bin/sh\n# oyster: idempotent\n");
  mkdirSync(dirname(linked.service_start_script_path), { recursive: true });
  symlinkSync(outside, linked.service_start_script_path);
  await assert.rejects(() => validateAndStoreHublotStartupScript(state, {
    id: linked.id, serviceStartScriptPath: linked.service_start_script_path,
  }), /invalid hublot startup script/);

  for (const id of [nonExecutable.id, nonIdempotent.id, linked.id]) {
    assert.equal((await store.repositories.hublots.find(id)).service_start_script, null);
    assert.equal((await store.repositories.hublots.find(id)).service_start_script_sha256, null);
  }
});
