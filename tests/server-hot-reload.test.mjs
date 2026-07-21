import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, copyFile, writeFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function fixture(version) {
  return `
export function init(state) {
  return {
    async handleRequest(_req, res) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: ${JSON.stringify(version)}, reloadCount: state.reloadCount }));
    },
    startPi() {},
    stopPi() {},
    stopTunnels() {},
    stopRoutines() {},
  };
}
`;
}

async function waitForOutput(child, match) {
  let output = "";
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(match)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`server exited with ${code}; output: ${output}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${match}; output: ${output}`));
    }, 5000);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

async function readJson(port) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  return response.json();
}

test("the stable server atomically replaces its active application handler", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ui-hot-reload-"));
  const port = await availablePort();
  await copyFile(new URL("../server.mjs", import.meta.url), join(root, "server.mjs"));
  await writeFile(join(root, "app.mjs"), fixture("before"));

  const child = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  assert.deepEqual(await readJson(port), { version: "before", reloadCount: 1 });

  const replacement = join(root, "app.replacement.mjs");
  await writeFile(replacement, fixture("after"));
  await rename(replacement, join(root, "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), { version: "after", reloadCount: 2 });
});
