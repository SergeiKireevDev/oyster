import test from "node:test";
import assert from "node:assert/strict";
import { checkpointResultMessage, createCheckpoint, openCheckpointModelPicker } from "../public/src/lib/checkpointActions.js";
import { listRoutines, runRoutine } from "../public/src/lib/routineActions.js";
import { createHublot, hublotVisible, refreshHublotScope, removeHublot } from "../public/src/lib/hublotActions.js";
import { saveFile, uploadFileChunk } from "../public/src/lib/fileBrowserActions.js";

test("hublot visibility keeps unbound tunnels and the active session", () => {
  assert.equal(hublotVisible({ sessionId: null }, false, "current"), true);
  assert.equal(hublotVisible({ sessionId: "current" }, false, "current"), true);
  assert.equal(hublotVisible({ sessionId: "other" }, false, "current"), false);
  assert.equal(hublotVisible({ sessionId: "other" }, true, "current"), true);
});

test("API actions normalize successful checkpoint and routine responses", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, status: 200, json: async () => ({ recorded: true }) };
  };
  await createCheckpoint(fetchImpl, "runner one", null);
  await runRoutine(fetchImpl, { name: "job", action: "start", sessionId: "session" });
  assert.match(calls[0][0], /runner=runner%20one/);
  assert.deepEqual(JSON.parse(calls[1][1].body), { name: "job", action: "start", sessionId: "session" });
});

test("checkpoint result messages describe committed and clean states", () => {
  assert.equal(checkpointResultMessage({ committed: true, summarized: false, files: 2, hash: "abc" }), "🧊 checkpoint abc — 2 files committed");
  assert.equal(checkpointResultMessage({ recorded: true, hash: "abc" }), "🧊 workdir clean — checkpoint marked at abc");
});

test("checkpoint model picker loads normalized model options", async () => {
  const options = [];
  const picker = openCheckpointModelPicker({
    openPicker: (config) => config,
    rpc: async () => ({ models: [{ provider: "openai", id: "gpt" }] }),
    setOptions: (models) => options.push(models),
  });
  await Promise.resolve();
  assert.equal(picker.loading, true);
  assert.deepEqual(options, [["openai/gpt"]]);
});

test("hublot scope action refreshes scoped stores", async () => {
  const calls = [];
  const next = await refreshHublotScope({ scopeAll: false, setScope: (v) => calls.push(["scope", v]), updateTitle: (v) => calls.push(["title", v]), refreshManager: async () => calls.push(["manager"]), refreshSidebar: () => calls.push(["sidebar"]), refreshRoutines: () => calls.push(["routines"]) });
  assert.equal(next, true);
  assert.deepEqual(calls, [["scope", true], ["title", true], ["manager"], ["sidebar"], ["routines"]]);
});

test("hublot create action preserves session payload", async () => {
  let body;
  await createHublot(async (_url, options) => { body = options.body; return { ok: true, status: 200, json: async () => ({ tunnel: {} }) }; }, { label: "demo", sessionId: "s", brief: "demo" });
  assert.deepEqual(JSON.parse(body), { label: "demo", sessionId: "s", brief: "demo" });
});

test("routine actions normalize list responses", async () => {
  const routines = await listRoutines(async () => ({ ok: true, status: 200, json: async () => ({ routines: [{ name: "job" }] }) }));
  assert.deepEqual(routines, [{ name: "job" }]);
});

test("file browser actions preserve save request contracts", async () => {
  let call;
  await saveFile(async (url, options) => { call = [url, options]; return { ok: true, status: 200, json: async () => ({ bytes: 4 }) }; }, { path: "/workspace/a.txt", content: "test" });
  assert.equal(call[0], "/file-save");
  assert.deepEqual(JSON.parse(call[1].body), { path: "/workspace/a.txt", content: "test" });
});

test("file browser chunk uploads preserve offset metadata", async () => {
  let url;
  await uploadFileChunk(async (nextUrl) => { url = nextUrl; return { ok: true, json: async () => ({}) }; }, { dir: "/workspace", name: "a b.txt", offset: 8, last: true, body: "x" });
  assert.match(url, /name=a%20b.txt.*offset=8.*last=1/);
});

test("API actions normalize server errors", async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: "already closed" }) });
  await assert.rejects(removeHublot(fetchImpl, "missing"), /already closed/);
});
