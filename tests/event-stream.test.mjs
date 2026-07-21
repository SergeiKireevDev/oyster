import test from "node:test";
import assert from "node:assert/strict";
import { openEventStream } from "../public/src/runtime/eventStream.js";

test("event stream opens an encoded runner/replay URL", () => {
  let url;
  const source = openEventStream({ token: "a b", runner: "runner/1", replay: false, EventSourceImpl: class { constructor(value) { url = value; } } });
  assert.ok(source);
  assert.equal(url, "/events?token=a%20b&runner=runner%2F1&replay=0");
});
