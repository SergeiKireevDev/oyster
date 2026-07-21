import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpoint } from "../public/src/lib/checkpointActions.js";
import { runRoutine } from "../public/src/lib/routineActions.js";
import { removeHublot } from "../public/src/lib/hublotActions.js";
import { saveFile, uploadFileChunk } from "../public/src/lib/fileBrowserActions.js";

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
