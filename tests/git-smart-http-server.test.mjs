import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "serve-git-smart-http.sh");

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

test("read-only Git Smart HTTP server requires an absolute worktree and supports clone and pull", async (t) => {
  const rejected = spawnSync(script, ["."], { cwd: root, encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /must be an absolute path/);

  const temporary = mkdtempSync(join(tmpdir(), "oyster-git-smart-http-"));
  const state = join(temporary, "state");
  const clone = join(temporary, "clone");
  const port = await unusedPort();
  const child = spawn(script, ["--port", String(port), "--state-dir", state, root], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode == null) await once(child, "exit").catch(() => {});
    rmSync(temporary, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${port}/`;
  let refs = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync("git", ["ls-remote", url], { encoding: "utf8" });
    if (result.status === 0) { refs = result.stdout; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(refs, /refs\/heads\/hub-spoke-llmbox-isolation/);
  const health = await fetch(`${url}?__oyster_hublot_health=probe`);
  assert.equal(health.status, 200);
  assert.match(await health.text(), /read-only Git Smart HTTP server/);
  execFileSync("git", ["clone", "--quiet", "--single-branch", "--branch", "hub-spoke-llmbox-isolation", url, clone]);
  assert.match(execFileSync("git", ["-C", clone, "pull", "--ff-only"], { encoding: "utf8" }), /Already up to date/);
  const push = spawnSync("git", ["-C", clone, "push", "origin", "HEAD:refs/heads/denied"], { encoding: "utf8" });
  assert.notEqual(push.status, 0);
  assert.match(`${push.stdout}${push.stderr}`, /403|disabled|not permitted|returned error/i);
});
