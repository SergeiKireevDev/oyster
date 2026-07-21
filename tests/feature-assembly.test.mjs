import test from "node:test";
import assert from "node:assert/strict";
import { createFeatureAssembly } from "../public/src/runtime/featureAssembly.js";
test("feature assembly tears down feature boundaries", () => {
  let count = 0;
  createFeatureAssembly({ platform: { teardown: () => count++ }, sessions: { teardown: () => count++ }, transcript: { teardown: () => count++ }, features: { files: { teardown: () => count++ } } }).teardown();
  assert.equal(count, 4);
});
