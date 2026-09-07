import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { discoverCodexModels, discoverGeminiModels, ampModels, withNativeRpc } from "../server/runner-drivers/native-models.mjs";

function fixture(handle) {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.emit("close"); return true; };
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const request = JSON.parse(String(chunk));
    requests.push(request);
    if (request.id != null) queueMicrotask(() => {
      const result = handle(request);
      if (result === undefined) return;
      child.stdout.write(`${JSON.stringify({ id: request.id, ...result })}\n`);
    });
    done();
  } });
  return { requests, options: { bin: "/bin/native", cwd: "/tmp", env: {}, spawnImpl: () => child, timeout: 100 } };
}

test("Codex discovers account-backed native models, follows pages, removes hidden/duplicate rows", async () => {
  const f = fixture(({ method, params }) => {
    if (method === "account/read") return { result: { account: { type: "chatgpt" } } };
    if (method === "model/list") return { result: params.cursor
      ? { data: [{ model: "astra" }, { model: "other", displayName: "Other" }] }
      : { data: [{ model: "astra", displayName: "Astra" }, { model: "hidden", hidden: true }], nextCursor: "next" } };
    return { result: {} };
  });
  assert.deepEqual(await discoverCodexModels(f.options), [
    { provider: "openai", id: "astra", name: "Astra" },
    { provider: "openai", id: "other", name: "Other" },
  ]);
  assert.deepEqual(f.requests.map((r) => r.method), ["initialize", "initialized", "account/read", "model/list", "model/list"]);
});

test("Codex without an account returns zero models without a prompt", async () => {
  const f = fixture(() => ({ result: {} }));
  assert.deepEqual(await discoverCodexModels(f.options), []);
  assert.equal(f.requests.some((r) => r.method === "model/list"), false);
});

test("Gemini uses ACP model IDs instead of Pi's API catalog", async () => {
  const f = fixture(({ method }) => ({ result: method === "session/new"
    ? { models: { availableModels: [{ modelId: "auto-gemini", name: "Auto" }] } } : {} }));
  assert.deepEqual(await discoverGeminiModels(f.options), [{ provider: "google", id: "auto-gemini", name: "Auto" }]);
  assert.deepEqual(f.requests.map((r) => r.method), ["initialize", "session/new"]);
});

test("Gemini auth-required becomes empty models but protocol failures remain errors", async () => {
  for (const code of [-32000, -32601]) {
    const f = fixture(({ method }) => method === "session/new" ? { error: { code, message: "failure" } } : { result: {} });
    if (code === -32000) assert.deepEqual(await discoverGeminiModels(f.options), []);
    else await assert.rejects(discoverGeminiModels(f.options), /failure/);
  }
});

test("native discovery times out and Amp offers supported modes, not arbitrary model IDs", async () => {
  const f = fixture(() => undefined);
  await assert.rejects(withNativeRpc({ ...f.options, args: [] }, (rpc) => rpc("test")), /timed out/);
  assert.deepEqual(ampModels().map((m) => m.id), ["low", "medium", "high", "ultra"]);
});
