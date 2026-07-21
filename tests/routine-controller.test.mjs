import test from "node:test";
import assert from "node:assert/strict";
import { createRoutineController, createRoutineSidebarController } from "../public/src/lib/routineController.js";
test("routine controller binds actions to the current session and refreshes", async () => {
  let request; let refreshes = 0;
  const controller = createRoutineController({ runRoutine: async (options) => { request = options; }, getSessionId: () => "session", refresh: () => refreshes++, toast: () => {} });
  await controller.run("job.sh", "start");
  assert.deepEqual(request, { name: "job.sh", action: "start", sessionId: "session" });
  assert.equal(refreshes, 1);
});

test("routine sidebar discards stale session loads and syncs live updates", async () => {
  let sessionId = "first";
  let resolveFirst;
  const calls = [];
  const visible = []; const totals = []; const loading = [];
  const controller = createRoutineSidebarController({
    listRoutines: () => new Promise((resolve) => { resolveFirst = resolve; }),
    isVisible: (routine) => routine.sessionId === sessionId,
    getSessionId: () => sessionId,
    getScopeAll: () => false,
    setRoutines: (items) => visible.push(items),
    setTotal: (total) => totals.push(total),
    setScopeAll: () => {},
    setCurrentSessionId: (id) => calls.push(id),
    setLoading: (value) => loading.push(value),
  });
  const firstLoad = controller.load();
  sessionId = "second";
  resolveFirst([{ path: "old", sessionId: "first" }]);
  await firstLoad;
  assert.deepEqual(visible, [[]]);
  assert.deepEqual(loading, [true]);
  controller.update({ path: "new", sessionId: "second" }, "created");
  assert.deepEqual(visible.at(-1), [{ path: "new", sessionId: "second" }]);
  assert.equal(totals.at(-1), 1);
  assert.deepEqual(calls, ["first", "second"]);
});
