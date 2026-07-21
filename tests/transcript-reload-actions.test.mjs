import test from "node:test";
import assert from "node:assert/strict";
import { loadCanonicalTranscript } from "../public/src/lib/transcriptReloadActions.js";

test("canonical reload applies state before returning messages", async () => {
  const events = [];
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "s" }),
    getMessages: async () => ({ messages: [{ role: "user" }] }),
    applyState: () => events.push("apply"), onState: () => events.push("state"), onMessages: () => events.push("messages"),
  });
  assert.deepEqual(result.messages, [{ role: "user" }]);
  assert.deepEqual(events.slice(0, 2), ["state", "apply"]);
});
