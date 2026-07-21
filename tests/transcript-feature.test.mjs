import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptFeature } from "../public/src/features/transcript/createTranscriptFeature.js";

test("transcript feature exposes session reload and stream handling", () => {
  const runtime = { reloadForSession: () => "reload", handleStreamEvent: () => "event" };
  const adapter = { scroll() {} };
  const feature = createTranscriptFeature({ createRuntime: () => runtime, dependencies: {}, domAdapter: adapter });
  assert.equal(feature.reloadForSession(), "reload");
  assert.equal(feature.handleStreamEvent(), "event");
  assert.equal(feature.getDomAdapter(), adapter);
  feature.teardown();
  assert.equal(feature.getDomAdapter(), null);
});
