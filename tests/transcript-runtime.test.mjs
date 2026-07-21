import test from "node:test";
import assert from "node:assert/strict";
import { createRenderJobs } from "../public/src/runtime/transcriptRuntime.js";

test("render jobs cancel stale backfills", () => {
  const jobs = createRenderJobs();
  const first = jobs.begin();
  assert.equal(jobs.isCurrent(first), true);
  const second = jobs.begin();
  assert.equal(jobs.isCurrent(first), false);
  assert.equal(jobs.isCurrent(second), true);
  jobs.cancel();
  assert.equal(jobs.isCurrent(second), false);
});
