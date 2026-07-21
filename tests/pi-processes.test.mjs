import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createPiProcessLauncher } from "../server/pi-processes.mjs";

const LOCAL_PI = process.env.PI_SQLITE_TEST_BIN ?? fileURLToPath(new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url));

test("pi process launcher pins executable and store environment", () => {
  const calls = [];
  const launcher = createPiProcessLauncher({
    config: { PI_BIN: "/local/pi", PERSISTENT_STORE: "sqlite" },
    spawnImpl: (...args) => { calls.push(args); return { pid: 1 }; },
  });
  launcher.launch(["--mode", "rpc"], { cwd: "/work", env: { PERSISTENT_STORE: "jsonl", CUSTOM: "yes" } });
  assert.equal(calls[0][0], "/local/pi");
  assert.deepEqual(calls[0][1], ["--mode", "rpc"]);
  assert.equal(calls[0][2].cwd, "/work");
  assert.equal(calls[0][2].env.PERSISTENT_STORE, "sqlite");
  assert.equal(calls[0][2].env.CUSTOM, "yes");
});

test("ephemeral pi processes always receive --no-session exactly once", () => {
  const calls = [];
  const launcher = createPiProcessLauncher({
    config: { PI_BIN: "/local/pi", PERSISTENT_STORE: "sqlite" },
    spawnImpl: (_bin, args) => { calls.push(args); return {}; },
  });
  launcher.ephemeral(["-p", "one shot"]);
  launcher.ephemeral(["--no-session", "-p", "already safe"]);
  assert.deepEqual(calls, [
    ["--no-session", "-p", "one shot"],
    ["--no-session", "-p", "already safe"],
  ]);
});

test("runner, checkpoint, and hublot code use the centralized pi launcher", () => {
  for (const path of ["../server/runners.mjs", "../server/checkpoints.mjs", "../server/tunnels.mjs"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /spawn\([^\n]*(?:PI_BIN|piBin)/);
  }
  assert.match(readFileSync(new URL("../server/runners.mjs", import.meta.url), "utf8"), /piProcesses\.launch/);
  assert.match(readFileSync(new URL("../server/checkpoints.mjs", import.meta.url), "utf8"), /piProcesses\.ephemeral/);
  assert.match(readFileSync(new URL("../server/tunnels.mjs", import.meta.url), "utf8"), /piProcesses\.ephemeral/);
});

test("local pi --no-session RPC startup creates no SQLite rows or database", {
  skip: process.env.PI_SQLITE_CONTRACT_TEST === "skip" ? "PI_SQLITE_CONTRACT_TEST=skip" : false,
  timeout: 30_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ephemeral-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const launcher = createPiProcessLauncher({ config: { PI_BIN: LOCAL_PI, PERSISTENT_STORE: "sqlite" } });
  const process = launcher.ephemeral(["--mode", "rpc", "--no-extensions", "--no-tools"], {
    cwd: root,
    env: { PI_CODING_AGENT_DIR: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { if (process.exitCode === null) process.kill("SIGTERM"); });
  let resolveState;
  const state = new Promise((resolve) => { resolveState = resolve; });
  createInterface({ input: process.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "response" && message.id === "state") resolveState(message);
    } catch {}
  });
  process.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
  const result = await state;
  assert.equal(result.success, true);
  process.kill("SIGTERM");
  await once(process, "exit");
  assert.equal(existsSync(join(root, "sessions.sqlite")), false);
});
