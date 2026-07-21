import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsLayoutRuntime } from "../public/src/features/settings/createSettingsLayoutRuntime.js";
test("settings/layout runtime tears down feature factories", () => { let n=0; const r=createSettingsLayoutRuntime({createSettings:()=>({teardown:()=>n++}),createLayout:()=>({teardown:()=>n++})}); r.teardown(); assert.equal(n,2); });
