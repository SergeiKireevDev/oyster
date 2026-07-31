import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createAsyncRequestGuard } from "../public/src/lib/asyncRequestGuard.js";

const component = (name) => readFile(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("async request guards reject superseded and post-destroy completions", () => {
  const guard = createAsyncRequestGuard();
  const older = guard.begin();
  const newer = guard.begin();

  assert.equal(older.isCurrent(), false);
  assert.equal(newer.isCurrent(), true);

  guard.invalidate();
  assert.equal(newer.isCurrent(), false);
  assert.equal(guard.begin().isCurrent(), false);
});

test("catalog and cloud option loaders guard stale completion", async () => {
  const [sidebar, cloud] = await Promise.all([
    component("SessionSidebar.svelte"),
    component("CloudWorkspaceModal.svelte"),
  ]);

  assert.match(sidebar, /catalogRequests\.begin\(\)/);
  assert.match(sidebar, /if \(!request\.isCurrent\(\)\) return/);
  assert.match(sidebar, /catalogRequests\.invalidate\(\)/);
  assert.match(cloud, /optionRequests\.begin\(\)/);
  assert.match(cloud, /handoffRequests\.begin\(\)/);
  assert.match(cloud, /optionRequests\.invalidate\(\)/);
  assert.match(cloud, /handoffRequests\.invalidate\(\)/);
});
