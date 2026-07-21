import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoutineRuntime } from "../public/src/features/routines/createRoutineRuntime.js";
test("routine runtime creates sidebar and actions", () => {
 const runtime = createRoutineRuntime({ listRoutines: async()=>[], isVisible:()=>true, getSessionId:()=>null, getScopeAll:()=>false, setRoutines(){}, setTotal(){}, setScopeAll(){}, setCurrentSessionId(){}, setLoading(){}, runRoutine:async()=>{}, toast(){} });
 assert.equal(typeof runtime.load, "function"); assert.equal(typeof runtime.controller.run, "function");
});

test("routine list routes session-scoped run requests through the UI registry", () => {
  const source = readFileSync(new URL("../public/src/components/RoutineList.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(ROUTINE_RUN_ACTION, name, action\)/);
  assert.doesNotMatch(source, /features\/routines\/routineActions\.js/);
});
