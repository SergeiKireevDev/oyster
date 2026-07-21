import test from "node:test";
import assert from "node:assert/strict";
import { createRoutineRuntime } from "../public/src/features/routines/createRoutineRuntime.js";
test("routine runtime creates sidebar and actions", () => {
 const runtime = createRoutineRuntime({ listRoutines: async()=>[], isVisible:()=>true, getSessionId:()=>null, getScopeAll:()=>false, setRoutines(){}, setTotal(){}, setScopeAll(){}, setCurrentSessionId(){}, setLoading(){}, runRoutine:async()=>{}, toast(){} });
 assert.equal(typeof runtime.load, "function"); assert.equal(typeof runtime.controller.run, "function");
});
