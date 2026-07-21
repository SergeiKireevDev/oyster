import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptFeature } from "../public/src/features/transcript/createTranscriptFeature.js";

test("transcript feature exposes session reload and stream handling", () => {
  const runtime = { reloadForSession: () => "reload", handleStreamEvent: () => "event" };
  const feature = createTranscriptFeature({ createRuntime: () => runtime, dependencies: {} });
  assert.equal(feature.reloadForSession(), "reload");
  assert.equal(feature.handleStreamEvent(), "event");
});
