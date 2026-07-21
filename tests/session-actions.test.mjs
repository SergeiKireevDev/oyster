import test from "node:test";
import assert from "node:assert/strict";
import { sessionFileQuery, transcriptGateRequired } from "../public/src/lib/sessionActions.js";

test("session actions use session-root-relative file queries", () => {
  assert.equal(sessionFileQuery("/home/me/.pi/agent/sessions/--workspace--/a.jsonl"), "path=--workspace--%2Fa.jsonl");
});
test("session actions skip transcript replay for empty runners", () => {
  const empty = new Set(["new"]);
  assert.equal(transcriptGateRequired({ runner: "new", messageCount: 1, emptySessionRunners: empty }), false);
  assert.equal(transcriptGateRequired({ runner: "old", messageCount: 1, emptySessionRunners: empty }), true);
});
