import test from "node:test";
import assert from "node:assert/strict";
import { storeSnapshot } from "../public/src/lib/storeSnapshot.js";
test("storeSnapshot returns a store value and unsubscribes", () => { let stopped = false; assert.equal(storeSnapshot({ subscribe(run) { run(3); return () => { stopped = true; }; } }), 3); assert.equal(stopped, true); });
