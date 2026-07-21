import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const extension = readFileSync(new URL("../extensions/routine.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../server/routines.mjs", import.meta.url), "utf8");

test("routine authoring contract requires granular and live progression", () => {
  assert.match(extension, /before and after every meaningful step/);
  assert.match(extension, /heartbeat message at least every 30 seconds/);
  assert.match(extension, /newline-terminated and flushed promptly/);
  assert.match(extension, /progressionWarnings/);
  assert.match(extension, /no explicit 100% completion update/);
});

test("routine generator gives one-shot agents the same progression contract", () => {
  assert.match(runtime, /explicit weighted steps for both modes/);
  assert.match(runtime, /relay native done\/total counts/);
  assert.match(runtime, /heartbeat at least every 30 seconds/);
});
