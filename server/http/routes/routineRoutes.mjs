const ROUTINE_NAME = /^[A-Za-z0-9][\w.-]*$/;
const ROUTINE_ACTIONS = new Set(["generate", "create", "start", "stop", "teardown", "release", "delete"]);
const MAX_SESSION_ID_LENGTH = 100;
const MAX_BRIEF_BYTES = 20_000;
const MAX_SCRIPT_BYTES = 256 * 1024;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function disableCaching(res) {
  res.setHeader?.("cache-control", "no-store");
}

function sessionIdFromBody(body) {
  if (body.sessionId === undefined || body.sessionId === null || body.sessionId === "") return null;
  if (typeof body.sessionId !== "string" || body.sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new TypeError(`sessionId must be a string of at most ${MAX_SESSION_ID_LENGTH} characters`);
  }
  return body.sessionId;
}

function sessionCwd(state, sessionId) {
  if (!sessionId) return state.currentDir;
  const runner = [...state.runners.values()].find((candidate) => candidate.sessionId === sessionId);
  return runner?.dir ?? state.sessionCatalog?.findById?.(sessionId)?.cwd ?? state.currentDir;
}

/** Build routine lifecycle routes around stable-core-owned routine state. */
export function createRoutineRoutes({ state, requestContext, routines, ensureSessionOwner = () => null }) {
  if (!state || typeof state !== "object" || !(state.runners instanceof Map)) {
    throw new TypeError("state with a runners Map is required");
  }
  if (!requestContext || typeof requestContext.json !== "function" || typeof requestContext.readJsonBody !== "function") {
    throw new TypeError("requestContext response and JSON body helpers are required");
  }
  const routineMethods = [
    "listRoutines", "routinesDir", "createRoutine", "startRoutine", "stopRoutine",
    "teardownRoutine", "releaseRoutine", "deleteRoutine", "spawnRoutineAgent",
  ];
  if (!routines || routineMethods.some((method) => typeof routines[method] !== "function")) {
    throw new TypeError("routine lifecycle methods are required");
  }
  if (typeof ensureSessionOwner !== "function") throw new TypeError("ensureSessionOwner must be a function");

  const { json, readJsonBody } = requestContext;
  const {
    listRoutines, routinesDir, createRoutine, startRoutine, stopRoutine,
    teardownRoutine, releaseRoutine, deleteRoutine, spawnRoutineAgent,
  } = routines;

  return {
    "GET /routines": (_req, res) => {
      disableCaching(res);
      json(res, 200, { routines: listRoutines(state), dir: routinesDir() });
    },

    "POST /routines": async (req, res) => {
      disableCaching(res);
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        json(res, 400, { error: "request body must be a JSON object" });
        return;
      }

      const action = typeof body.action === "string" ? body.action : "";
      if (!ROUTINE_ACTIONS.has(action)) {
        json(res, 400, { error: `unknown action: ${action}` });
        return;
      }

      let sessionId;
      try {
        sessionId = sessionIdFromBody(body);
      } catch (error) {
        json(res, 400, { error: errorMessage(error) });
        return;
      }

      const name = action === "generate" ? null : (typeof body.name === "string" ? body.name.trim() : "");
      if (action !== "generate" && !ROUTINE_NAME.test(name)) {
        json(res, 400, { error: `invalid routine name: ${name}` });
        return;
      }

      try {
        if (action === "generate") {
          const brief = typeof body.brief === "string" ? body.brief.trim() : "";
          if (!brief || Buffer.byteLength(brief) > MAX_BRIEF_BYTES) {
            json(res, 400, { error: "generate requires a `brief` string (max 20KB)" });
            return;
          }
          if (!sessionId) {
            json(res, 400, { error: "generate requires a current session" });
            return;
          }
          ensureSessionOwner(sessionId);
          const agent = await spawnRoutineAgent(state, { brief, sessionId });
          json(res, 201, { agent: true, output: agent.output, routines: listRoutines(state) });
          return;
        }

        if (action === "create") {
          const script = typeof body.script === "string" ? body.script : null;
          if (!script || Buffer.byteLength(script) > MAX_SCRIPT_BYTES) {
            json(res, 400, { error: "create requires a `script` string (max 256KB)" });
            return;
          }
          const owner = sessionId ? ensureSessionOwner(sessionId) : null;
          json(res, 201, {
            routine: createRoutine(state, {
              name, script, sessionId, ownerId: owner?.id ?? null, cwd: sessionCwd(state, sessionId),
            }),
          });
          return;
        }
        if (action === "start") {
          const owner = sessionId ? ensureSessionOwner(sessionId) : null;
          json(res, 200, {
            routine: startRoutine(state, name, {
              sessionId, ownerId: owner?.id ?? null, cwd: sessionCwd(state, sessionId),
            }),
          });
          return;
        }

        const operation = {
          stop: stopRoutine,
          teardown: teardownRoutine,
          release: releaseRoutine,
          delete: deleteRoutine,
        }[action];
        json(res, 200, { routine: operation(state, name) });
      } catch (error) {
        json(res, 400, { error: errorMessage(error) });
      }
    },
  };
}
