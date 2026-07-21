import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");
const checkpointSource = readFileSync(new URL("../server/checkpoints.mjs", import.meta.url), "utf8");
const routineSource = readFileSync(new URL("../server/routines.mjs", import.meta.url), "utf8");

test("runtime startup does not automatically read legacy application stores", () => {
  assert.doesNotMatch(appSource, /checkpointImporter|routineImporter|importLegacy/);
  assert.doesNotMatch(appSource, /legacy(?:Checkpoints|Routines)Imported/);
});

test("checkpoint and routine runtime modules have no legacy-file write fallback", () => {
  assert.doesNotMatch(checkpointSource, /checkpoints\.json|loadLegacy|saveLegacy|writeFileSync|renameSync/);
  assert.doesNotMatch(checkpointSource, /options\.(?:load|save)Checkpoints/);
  assert.match(checkpointSource, /SQLite checkpoint repository is required/);
  assert.doesNotMatch(routineSource, /bindings\.json|LEGACY_ROUTINES|routineImporter/);
});
