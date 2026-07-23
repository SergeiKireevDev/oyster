import test from "node:test";
import assert from "node:assert/strict";
import { abbreviateHomePath } from "../public/src/lib/pathDisplay.js";

test("home paths are abbreviated for display", () => {
  assert.equal(abbreviateHomePath("/home/ubuntu/project"), "~/project");
  assert.equal(abbreviateHomePath("/home/ubuntu"), "~");
  assert.equal(abbreviateHomePath("/root/project"), "~/project");
  assert.equal(abbreviateHomePath("/Users/alice/project"), "~/project");
});

test("paths outside conventional home directories remain unchanged", () => {
  assert.equal(abbreviateHomePath("/workspace/project"), "/workspace/project");
  assert.equal(abbreviateHomePath("/home"), "/home");
  assert.equal(abbreviateHomePath(null), null);
});
