import test from "node:test";
import assert from "node:assert/strict";
import { alignedTranscriptIndex, splitTurns, takeTailChunk } from "../public/src/lib/transcriptUtils.js";

test("transcript utils: align transcript positions from the tail", () => {
  assert.equal(alignedTranscriptIndex(3, 2, 2), 1);
  assert.equal(alignedTranscriptIndex(2, 2, 1), 1);
});

test("transcript utils: splitTurns starts a new turn at each user message", () => {
  const messages = [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "toolResult", content: "three" },
    { role: "user", content: "four" },
    { role: "assistant", content: "five" },
  ];
  assert.deepEqual(splitTurns(messages), [
    [messages[0], messages[1], messages[2]],
    [messages[3], messages[4]],
  ]);
});

test("transcript utils: splitTurns keeps leading non-user messages together", () => {
  const messages = [
    { role: "assistant", content: "orphan" },
    { role: "toolResult", content: "result" },
    { role: "user", content: "next" },
  ];
  assert.deepEqual(splitTurns(messages), [
    [messages[0], messages[1]],
    [messages[2]],
  ]);
});

test("transcript utils: takeTailChunk pops whole turns from the end", () => {
  const turns = [
    [{ role: "user", id: 1 }, { role: "assistant", id: 2 }],
    [{ role: "user", id: 3 }, { role: "assistant", id: 4 }, { role: "toolResult", id: 5 }],
    [{ role: "user", id: 6 }],
  ];
  const tail = takeTailChunk(turns, 3);
  assert.deepEqual(tail.map((message) => message.id), [6]);
  assert.equal(turns.length, 2);

  const next = takeTailChunk(turns, 3);
  assert.deepEqual(next.map((message) => message.id), [3, 4, 5]);
  assert.equal(turns.length, 1);
});
