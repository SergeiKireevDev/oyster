import test from "node:test";
import assert from "node:assert/strict";
import { createSessionFeature } from "../public/src/features/sessions/createSessionFeature.js";

test("session feature exposes its runtime operations", () => {
  const runtime = { openSession: () => "open", switchRunner: () => "switch", refreshState: () => "refresh", getCurrentSession: () => "current" };
  const feature = createSessionFeature({ createRuntime: () => runtime, dependencies: {} });
  assert.equal(feature.openSession(), "open");
  assert.equal(feature.getCurrentSession(), "current");
  feature.setCurrentSession("fallback");
  assert.equal(feature.getCurrentSession(), "current");
});
