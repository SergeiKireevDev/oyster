import test from "node:test";
import assert from "node:assert/strict";
import { openLlmboxBinding } from "../oyster-hub/llmbox-binding.mjs";
import { createLlmboxDriver } from "../oyster-hub/drivers/llmbox.mjs";

function fakeAddon() {
  const calls = [];
  return {
    calls,
    async open(raw) {
      calls.push(["open", JSON.parse(raw)]);
      return JSON.stringify({ ok: true, handle: 7, addr: "127.0.0.1:4321" });
    },
    async invoke(handle, operation, raw, timeout) {
      const input = JSON.parse(raw);
      calls.push(["invoke", handle, operation, input, timeout]);
      const values = {
        "spoke-statuses": { spokes: [{ name: "edge-1", connected: true, default: true }] },
        "list-boxes": { boxes: [{ instance_id: "g1", box_id: "alpha", description: "Alpha", spoke: "edge-1", state: "running" }] },
        "list-proxies": { proxies: [{ box_id: "alpha", port: 8080, url: "https://alpha.test" }] },
        "create-box": { session: { BoxID: input.opts?.BoxID, Generation: "g2" } },
        "create-proxy": { proxy: { box_id: input.box_id, port: input.port, url: "https://created.test" } },
      };
      return JSON.stringify({ ok: true, value: values[operation] ?? {} });
    },
    async close(handle, timeout) {
      calls.push(["close", handle, timeout]);
      return JSON.stringify({ ok: true });
    },
  };
}

const nativeConfig = {
  addonPath: "/tmp/llmbox.node",
  configPath: "/tmp/llmbox.yaml",
  timeoutMs: 1234,
  closeTimeoutMs: 4321,
};

test("llmbox binding wraps asynchronous native envelopes and closes once", async () => {
  const addon = fakeAddon();
  const binding = await openLlmboxBinding(nativeConfig, { loadAddon: () => addon });
  assert.equal(binding.address, "127.0.0.1:4321");
  assert.deepEqual(await binding.invoke("list-boxes"), { boxes: [{ instance_id: "g1", box_id: "alpha", description: "Alpha", spoke: "edge-1", state: "running" }] });
  await Promise.all([binding.close(), binding.close()]);
  assert.equal(addon.calls.filter(([name]) => name === "close").length, 1);
  assert.rejects(() => binding.invoke("list-boxes"), /binding is closed/);
});

test("native llmbox workspace driver uses bindings instead of fetch", async () => {
  const addon = fakeAddon();
  const binding = await openLlmboxBinding(nativeConfig, { loadAddon: () => addon });
  const driver = createLlmboxDriver({
    type: "llmbox",
    transport: "native",
    endpoint: "native://embedded-llmbox",
    tokenSecret: "workspace-secret",
    timeoutMs: 1234,
    createTimeoutMs: 9876,
    workspacePort: 8080,
    createProxy: true,
    tokenFile: { path: "/run/oyster-token", mode: 384, uid: 1000, gid: 1000 },
  }, {
    binding,
    fetchImpl() { throw new Error("HTTP must not be used"); },
  });

  assert.deepEqual(await driver.listEnvironments(), [
    { id: "edge-1", name: "edge-1", kind: "llmbox", status: "online", default: true, spoke: "edge-1" },
  ]);
  const workspaces = await driver.listWorkspaces();
  assert.equal(workspaces[0].url, "https://alpha.test");
  const created = await driver.createWorkspace({ id: "created", name: "Created", spoke: "edge-1" });
  assert.equal(created.url, "https://created.test");
  assert.equal((await driver.pauseWorkspace("alpha")).status, "paused");
  assert.equal((await driver.resumeWorkspace("alpha")).status, "online");
  assert.equal((await driver.removeWorkspace("alpha")).destroyed, true);
  const invokeCalls = addon.calls.filter(([name]) => name === "invoke");
  assert.deepEqual(invokeCalls.map((call) => call[2]), [
    "spoke-statuses", "list-boxes", "list-proxies", "create-box", "create-proxy",
    "pause-box", "resume-box", "destroy-box",
  ]);
  assert.equal(invokeCalls.find((call) => call[2] === "create-box")[4], 9876);
  assert.ok(invokeCalls.filter((call) => call[2] !== "create-box").every((call) => call[4] === 1234));
  await binding.close();
});

test("llmbox binding surfaces native failures without leaking malformed envelopes", async () => {
  const addon = fakeAddon();
  addon.open = async () => JSON.stringify({ ok: false, error: "cannot open store" });
  await assert.rejects(
    () => openLlmboxBinding(nativeConfig, { loadAddon: () => addon }),
    /cannot open store/,
  );
});
