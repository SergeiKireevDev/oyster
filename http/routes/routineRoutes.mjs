/** Build routine lifecycle routes around stable-core-owned routine state. */
export function createRoutineRoutes({ state, requestContext, routines }) {
  const { json, readJsonBody } = requestContext;
  const {
    listRoutines, routinesDir, createRoutine, startRoutine, stopRoutine,
    teardownRoutine, releaseRoutine, deleteRoutine,
  } = routines;

  return {
    "GET /routines": (_req, res) => {
      json(res, 200, { routines: listRoutines(state), dir: routinesDir() });
    },

    "POST /routines": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const name = String(body?.name ?? "").trim();
      const action = String(body?.action ?? "");
      const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
      if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
        json(res, 400, { error: `invalid routine name: ${name}` });
        return;
      }
      const sessionCwd = () => {
        const runner = sessionId
          ? [...state.runners.values()].find((candidate) => candidate.sessionId === sessionId)
          : null;
        return runner?.dir ?? state.currentDir;
      };
      try {
        if (action === "create") {
          const script = typeof body?.script === "string" ? body.script : null;
          if (!script || script.length > 256 * 1024) {
            json(res, 400, { error: "create requires a `script` string (max 256KB)" });
            return;
          }
          json(res, 201, { routine: createRoutine(state, { name, script, sessionId, cwd: sessionCwd() }) });
        } else if (action === "start") {
          json(res, 200, { routine: startRoutine(state, name, { sessionId, cwd: sessionCwd() }) });
        } else if (action === "stop") json(res, 200, { routine: stopRoutine(state, name) });
        else if (action === "teardown") json(res, 200, { routine: teardownRoutine(state, name) });
        else if (action === "release") json(res, 200, { routine: releaseRoutine(state, name) });
        else if (action === "delete") json(res, 200, { routine: deleteRoutine(state, name) });
        else json(res, 400, { error: `unknown action: ${action}` });
      } catch (error) {
        json(res, 400, { error: error.message });
      }
    },
  };
}
