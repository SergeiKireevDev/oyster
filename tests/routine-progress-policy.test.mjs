import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { progressionWarnings } from "../server/routine-progress-policy.mjs";

// The extension is also distributed as a standalone file. Do not make it depend
// on server-relative imports; execute its private checker against shared cases.
const source = readFileSync(new URL("../extensions/routine.ts", import.meta.url), "utf8");
const checker = source.match(/function progressionWarnings\(script: string\): string\[\] \{[\s\S]*?\n\}/)?.[0];
assert.ok(checker, "standalone extension progression checker is present");
const extensionWarnings = new Function(`${stripTypeScriptTypes(checker)}; return progressionWarnings;`)();
const fewer = "fewer than three explicit progress updates";
const start = "no explicit starting progress update";
const end = "no explicit 100% completion update";
const cases = [
  ["", [fewer, start, end]],
  ["::progress 0 start\n::progress 50 halfway\n::progress 100 done", []],
  ['echo "::progress 0% starting"\necho "::progress 50% middle"\necho "::progress 100% done"', []],
  ["::progress 0 start\n::progress 100 done", [fewer]],
  ["::progress 10 start\n::progress 50 middle\n::progress 100 done", [start]],
  ["::progress 0 start\n::progress 50 middle\n::progress 99 end", [end]],
  ["::progress 7 start\n::progress note\n::progress 100 done", []],
  ["::progression 0\n::progression 50\n::progression 100", [fewer, start, end]],
];

for (const [script, expected] of cases) {
  test(`MCP and standalone extension retain advisory progress policy: ${JSON.stringify(script)}`, () => {
    assert.deepEqual(progressionWarnings(script), expected);
    assert.deepEqual(extensionWarnings(script), expected);
  });
}
