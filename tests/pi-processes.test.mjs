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

test("pi process launcher pins executable, store, and Oyster authentication environment", () => {
  const calls = [];
  const launcher = createPiProcessLauncher({
    config: {
      PI_BIN: "/local/pi", PERSISTENT_STORE: "sqlite", TOKEN: "effective-ui-token",
      OYSTER_URL: "http://127.0.0.1:8083",
    },
    spawnImpl: (...args) => { calls.push(args); return { pid: 1 }; },
  });
  launcher.launch(["--mode", "rpc"], { cwd: "/work", env: { PERSISTENT_STORE: "jsonl", CUSTOM: "yes" } });
  assert.equal(calls[0][0], "/local/pi");
  assert.deepEqual(calls[0][1], ["--mode", "rpc"]);
  assert.equal(calls[0][2].cwd, "/work");
  assert.equal(calls[0][2].env.PERSISTENT_STORE, "sqlite");
  assert.equal(calls[0][2].env.OYSTER_TOKEN, "effective-ui-token");
  assert.equal(calls[0][2].env.OYSTER_URL, "http://127.0.0.1:8083");
  assert.equal(calls[0][2].env.CUSTOM, "yes");
});

test("launcher snapshots process policy and does not leak an unconfigured token", () => {
  const calls = [];
  const config = {
    PI_BIN: "/local/pi",
    PERSISTENT_STORE: "sqlite",
    TOKEN: "original-token",
    OYSTER_URL: " http://127.0.0.1:8083 ",
  };
  const launcher = createPiProcessLauncher({
    config,
    spawnImpl: (...args) => { calls.push(args); return {}; },
  });
  config.PI_BIN = "/replaced/pi";
  config.PERSISTENT_STORE = "jsonl";
  config.TOKEN = "replaced-token";
  config.OYSTER_URL = "http://elsewhere.invalid";

  launcher.launch([]);
  assert.equal(launcher.bin, "/local/pi");
  assert.equal(calls[0][0], "/local/pi");
  assert.equal(calls[0][2].env.PERSISTENT_STORE, "sqlite");
  assert.equal(calls[0][2].env.OYSTER_TOKEN, "original-token");
  assert.equal(calls[0][2].env.OYSTER_URL, "http://127.0.0.1:8083");

  const withoutToken = createPiProcessLauncher({
    config: { PI_BIN: "/local/pi" },
    spawnImpl: (...args) => { calls.push(args); return {}; },
  });
  withoutToken.launch([], { env: { OYSTER_TOKEN: "stale-token" } });
  assert.equal("OYSTER_TOKEN" in calls[1][2].env, false);
});

test("pi process launcher rejects malformed process inputs", () => {
  assert.throws(() => createPiProcessLauncher(), /PI_BIN must be a non-empty string/);
  assert.throws(() => createPiProcessLauncher({ config: { PI_BIN: "  " } }), /PI_BIN must be a non-empty string/);
  assert.throws(() => createPiProcessLauncher({ config: { PI_BIN: "/pi" }, spawnImpl: null }), /spawnImpl must be a function/);

  const launcher = createPiProcessLauncher({ config: { PI_BIN: "/pi" }, spawnImpl() {} });
  assert.throws(() => launcher.launch("--mode rpc"), /arguments must be an array of strings/);
  assert.throws(() => launcher.launch(["--mode", 1]), /arguments must be an array of strings/);
  assert.throws(() => launcher.launch([], null), /options must be an object/);
  assert.throws(() => launcher.launch([], { env: null }), /environment must be an object/);
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

test("runner drivers, checkpoints, and hublots preserve centralized process boundaries", () => {
  for (const path of ["../server/runners.mjs", "../server/checkpoints.mjs", "../server/tunnels.mjs"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /spawn\([^\n]*(?:PI_BIN|piBin)/);
  }
  const runners = readFileSync(new URL("../server/runners.mjs", import.meta.url), "utf8");
  const piDriver = readFileSync(new URL("../server/runner-drivers/pi-rpc.mjs", import.meta.url), "utf8");
  assert.match(runners, /runnerDriver\.launch/);
  assert.doesNotMatch(runners, /piProcesses\.launch/);
  assert.match(piDriver, /processLauncher\.launch/);
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
