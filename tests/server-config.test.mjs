import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = new URL("../server.mjs", import.meta.url);
const LOCAL_PI = "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";

function checkConfig({ args = [], env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-ui-config-"));
  const childEnv = { ...process.env, HOME: home, ...env };
  delete childEnv.PI_ARGS;
  delete childEnv.PI_BIN;
  delete childEnv.PI_CODING_AGENT_DIR;
  delete childEnv.PERSISTENT_STORE;
  Object.assign(childEnv, env);
  const result = spawnSync(process.execPath, [SERVER.pathname, "--check-config", ...args], {
    encoding: "utf8",
    env: childEnv,
  });
  rmSync(home, { recursive: true, force: true });
  return result;
}

test("development configuration selects the local SQLite pi build", { skip: !existsSync(LOCAL_PI) }, () => {
  const result = checkConfig();
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.piBin, LOCAL_PI);
  assert.equal(config.persistentStore, "sqlite");
  assert.match(config.sqlitePath, /\.pi\/agent\/sessions\.sqlite$/);
  assert.ok(Number(config.node.split(".")[0]) >= 22);
});

test("configuration accepts an explicit executable and JSONL rollback", () => {
  const result = checkConfig({ args: ["--pi", process.execPath], env: { PERSISTENT_STORE: "JSONL" } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    piBin: process.execPath,
    persistentStore: "jsonl",
    sqlitePath: null,
    node: process.versions.node,
  });
});

test("SQLite database follows the configured agent or session directory", () => {
  const agentDir = join(tmpdir(), "custom-pi-agent");
  let result = checkConfig({ args: ["--pi", process.execPath], env: { PI_CODING_AGENT_DIR: agentDir } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sqlitePath, join(agentDir, "sessions.sqlite"));

  const sessionDir = join(tmpdir(), "custom-pi-sessions");
  result = checkConfig({
    args: ["--pi", process.execPath, "--pi-args", `--session-dir ${sessionDir}`],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sqlitePath, join(sessionDir, "sessions.sqlite"));
});

test("configuration rejects invalid stores and missing executables", () => {
  let result = checkConfig({ args: ["--pi", process.execPath], env: { PERSISTENT_STORE: "memory" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid PERSISTENT_STORE.*jsonl.*sqlite/);

  result = checkConfig({ args: ["--pi", join(tmpdir(), "missing-pi")] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pi executable is missing or not executable/);
});
