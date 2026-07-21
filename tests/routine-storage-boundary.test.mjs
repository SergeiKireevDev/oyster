import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routines.mjs", import.meta.url), "utf8");

test("routine definitions and bindings are loaded only from the app repository", () => {
  assert.match(source, /state\.appStore\?\.repositories\?\.routines/);
  assert.match(source, /routineRepository\(state\)\.list\(\)/);
  assert.doesNotMatch(source, /bindings\.json|loadBindings|saveBinding|readdirSync|scanRoutinesDisk/);
});
