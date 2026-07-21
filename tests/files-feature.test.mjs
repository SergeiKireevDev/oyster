import test from "node:test";
import assert from "node:assert/strict";
import { createFilesFeature } from "../public/src/features/files/createFilesFeature.js";

test("files feature requires injected controller dependencies", () => {
  assert.throws(() => createFilesFeature({}), TypeError);
});
