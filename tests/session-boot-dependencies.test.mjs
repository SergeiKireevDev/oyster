import test from "node:test";
import assert from "node:assert/strict";
import { createSessionBootDependencies } from "../public/src/runtime/sessionBootDependencies.js";

test("session boot dependency assembly preserves injected lifecycle callbacks", () => {
  const route = {};
  const lookupSession = () => {};
  const dependencies = createSessionBootDependencies({
    route, lookupSession, openInitialSession: () => {}, setAfterTranscript: () => {},
    focusEntry: () => {}, connect: () => {}, log: () => {}, toast: () => {},
  });
  assert.equal(dependencies.route, route);
  assert.equal(dependencies.lookupSession, lookupSession);
  assert.equal(typeof dependencies.connect, "function");
});
