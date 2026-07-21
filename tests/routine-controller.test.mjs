import test from "node:test";
import assert from "node:assert/strict";
import { createRoutineController } from "../public/src/lib/routineController.js";
test("routine controller binds actions to the current session and refreshes", async () => {
  let request; let refreshes = 0;
  const controller = createRoutineController({ runRoutine: async (options) => { request = options; }, getSessionId: () => "session", refresh: () => refreshes++, toast: () => {} });
  await controller.run("job.sh", "start");
  assert.deepEqual(request, { name: "job.sh", action: "start", sessionId: "session" });
  assert.equal(refreshes, 1);
});
