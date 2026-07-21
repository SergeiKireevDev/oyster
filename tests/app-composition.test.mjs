import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/runtime/appComposition.js", import.meta.url), "utf8");
const legacyImplementation = new URL("../public/src/runtime/appRuntimeImplementation.js", import.meta.url);

test("legacy implementation module has been removed", () => {
  assert.equal(existsSync(legacyImplementation), false);
});

test("composition entrypoint is a canonical re-export without a compatibility wrapper", () => {
  assert.equal(source.trim(), 'export { createApplicationRuntimeDependencies } from "./appCompositionRoot.js";');
});
