import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createRunnerManager } from "../server/runners.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";
import { createPiRpcDriver } from "../server/runner-drivers/pi-rpc.mjs";
import { createClaudeCodeDriver } from "../server/runner-drivers/claude-code.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createGeminiDriver } from "../server/runner-drivers/gemini.mjs";
import { createAmpDriver } from "../server/runner-drivers/amp.mjs";
import { createAntigravityDriver } from "../server/runner-drivers/antigravity.mjs";

const factories = {
  pi: null, "claude-code": createClaudeCodeDriver, codex: createCodexDriver,
  gemini: createGeminiDriver, amp: createAmpDriver, antigravity: createAntigravityDriver,
};

async function eventually(read, check) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("runner identity was not persisted");
}

for (const [harness, factory] of Object.entries(factories)) {
  test(`${harness} persists startup identity and safely restarts an empty session`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "oyster-startup-id-"));
    const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
    const sqlitePath = join(root, "sessions.sqlite");
    const config = { PI_BIN: "/fake/pi", PI_EXTRA_ARGS: [], PERSISTENT_STORE: "sqlite", SQLITE_PATH: sqlitePath };
    const launches = [];
    const batches = [];
    const instances = [];
    const spawnImpl = (bin, args) => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.exitCode = null;
      child.kill = () => { child.exitCode = 0; child.emit("exit", 0); };
      launches.push({ bin, args, child });
      if (harness === "pi") child.stdin.on("data", (data) => {
        for (const line of String(data).trim().split("\n")) {
          const command = JSON.parse(line);
          if (command.type === "get_state") child.stdout.write(JSON.stringify({
            type: "response", id: command.id, command: "get_state", success: true,
            data: { sessionId: "pi-session", sessionName: null, sessionFile: null, messageCount: 0 },
          }) + "\n");
        }
      });
      return child;
    };
    const driver = factory
      ? factory({ bin: "/fake/agent", sqlitePath, spawnImpl, transcriptSink: { async append(batch) { batches.push(batch); } } })
      : createPiRpcDriver({ config, processLauncher: { launch: (args) => spawnImpl("/fake/pi", args) } });
    async function manager() {
      const state = {
        config, currentDir: root, runners: new Map(), sseClients: new Set(), appStore: store,
        sessionReferences: createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath }),
        serverEvent() {},
      };
      const manager = await createRunnerManager(state, {
        runnerDriver: driver,
        ensureSessionOwner: (ref) => store.repositories.sessions.upsert({
          backend: ref.backend, sessionId: ref.id, storagePath: ref.storagePath, createdAt: new Date().toISOString(),
        }),
      });
      instances.push({ state, manager });
      return { state, manager };
    }
    t.after(async () => {
      for (const { state, manager } of instances) {
        clearInterval(state.runnerWatchdogTimer); clearInterval(state.runnerReaperTimer);
        await manager.stopPi();
      }
      await store.close();
      await rm(root, { recursive: true, force: true });
    });

    const first = await manager();
    const runner = await first.manager.spawnRunner({ dir: root });
    const saved = await eventually(() => store.repositories.runners.find(runner.id), (row) => Boolean(row?.session_id));
    assert.equal(saved.session_backend, "sqlite");
    assert.equal(saved.session_initialized, harness === "pi" ? 1 : 0);
    assert.equal(batches.length, 0, "startup identity must not create transcript rows");
    await store.repositories.pinnedWidgets.create({
      id: "before-prompt", ownerId: saved.owner_id, scope: "session", kind: "file",
      label: "Pinned before first prompt", position: 0, target: "/work/example.txt", createdAt: "now",
    });
    await first.manager.stopRunner(runner);

    // Reconstruct from SQLite with no driver runtime retained.
    const restored = await manager();
    const empty = restored.state.runners.get(runner.id);
    assert.equal(empty.sessionId, saved.session_id);
    assert.equal(empty.sessionInitialized, harness === "pi");
    await restored.manager.startRunner(empty);
    const launch = launches.at(-1);
    if (harness === "claude-code") {
      assert.equal(launch.args.includes("--resume"), false);
      assert.equal(launch.args[launch.args.indexOf("--session-id") + 1], saved.session_id);
    } else if (harness === "pi") {
      assert.equal(launch.args[launch.args.indexOf("--session") + 1], saved.session_id);
    } else {
      await restored.manager.sendToRunner(empty, { id: "prompt", type: "prompt", message: "hello" });
      const command = JSON.parse(String(launch.child.stdin.read()).trim());
      assert.equal(command.resume, false, "an empty session must start a new native conversation");
      assert.equal(command.sessionId, harness === "gemini" ? saved.session_id : null);
      assert.equal(batches.length, 0, "provisional IDs must not receive transcript messages");
    }

    if (harness === "pi") return;
    const nativeId = ["claude-code", "gemini"].includes(harness) ? saved.session_id : "native-session";
    const init = harness === "codex" ? { type: "thread.started", thread_id: nativeId }
      : harness === "antigravity" ? { event: "init", conversation_id: nativeId, init: { model: "native-model" } }
        : harness === "gemini" ? { type: "init", session_id: nativeId }
          : { type: "system", subtype: "init", session_id: nativeId };
    // Also cover an owner created by another consumer of the native identity.
    if (harness === "codex") await store.repositories.sessions.upsert({
      backend: "sqlite", sessionId: nativeId, storagePath: sqlitePath, createdAt: "native",
    });
    launch.child.stdout.write(JSON.stringify(init) + "\n");
    await eventually(() => store.repositories.runners.find(runner.id),
      (row) => row?.session_id === nativeId && row.session_initialized === 1);
    const pin = await store.repositories.pinnedWidgets.find("before-prompt");
    assert.equal(pin.session_id, nativeId, "pins follow the provisional-to-native identity transition");
    if (harness !== "claude-code") {
      await empty.driverRuntime.transcriptPending;
      assert.equal(batches.length, 1);
      assert.equal(batches[0].sessionId, nativeId);
      assert.equal(batches[0].entries[0].message.content, "hello");
    }
    await restored.manager.stopRunner(empty);
    const resumed = await manager();
    const conversation = resumed.state.runners.get(runner.id);
    await resumed.manager.startRunner(conversation);
    const next = launches.at(-1);
    if (harness === "claude-code") {
      assert.equal(next.args[next.args.indexOf("--resume") + 1], nativeId);
    } else {
      await resumed.manager.sendToRunner(conversation, { id: "next", type: "prompt", message: "continue" });
      const command = JSON.parse(String(next.child.stdin.read()).trim());
      assert.equal(command.resume, true);
      assert.equal(command.sessionId, nativeId);
    }
  });
}
