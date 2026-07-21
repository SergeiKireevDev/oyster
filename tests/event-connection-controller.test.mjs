import test from "node:test";
import assert from "node:assert/strict";
import { createEventConnectionController } from "../public/src/runtime/eventConnectionController.js";

test("event connection controller resets replay state and injects source handlers", () => {
  const calls = []; let handlers;
  const connect = createEventConnectionController({
    getToken: () => "token", requireToken: () => calls.push("auth"), close: () => calls.push("close"), setLastEventAt: () => {},
    setGate: (value) => calls.push(["gate", value]), setReplaying: (value, phase) => calls.push(["replay", value, phase]),
    setReplayDoneSeen: (value) => calls.push(["done", value]), setReplayBuffer: (value) => calls.push(["buffer", value]),
    getSkipTranscriptGate: () => false, connect: (_options, next) => { handlers = next; return "source"; }, setSource: (source) => calls.push(["source", source]),
    onOpen: () => calls.push("open"), onError: () => calls.push("error"), onMessage: () => calls.push("message"),
  });
  assert.equal(connect({ replay: false }), "source");
  handlers.onopen(); handlers.onerror(); handlers.onmessage();
  assert.deepEqual(calls, ["close", ["gate", true], ["replay", true, "replay"], ["done", false], ["buffer", []], ["source", "source"], "open", "error", "message"]);
});
