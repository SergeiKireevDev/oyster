const BYTES_PER_KIBIBYTE = 1024;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const MAX_SCRIPT_KIBIBYTES = 256;
const HTTP_BAD_REQUEST = 400;

const ROUTINE_NAME = /^[A-Za-z0-9][\w.-]*$/;
const ROUTINE_ACTIONS = new Set(["generate", "create", "start", "stop", "teardown", "release", "delete"]);
const MAX_SESSION_ID_LENGTH = 100;
const MAX_BRIEF_BYTES = 20_000;
const MAX_SCRIPT_BYTES = MAX_SCRIPT_KIBIBYTES * BYTES_PER_KIBIBYTE;

import { errorMessage } from "../../errors.mjs";
import { disableCaching } from "../createRequestContext.mjs";

function sessionIdFromBody(body) {
  if (body.sessionId === undefined || body.sessionId === null || body.sessionId === "") return null;
  if (typeof body.sessionId !== "string" || body.sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new TypeError(`sessionId must be a string of at most ${MAX_SESSION_ID_LENGTH} characters`);
  }
  return body.sessionId;
}

async function sessionCwd(state, sessionId) {
  if (!sessionId) return state.currentDir;
  const runner = [...state.runners.values()].find((candidate) => candidate.sessionId === sessionId);
  return runner?.dir ?? (await state.sessionCatalog?.findById?.(sessionId))?.cwd ?? state.currentDir;
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

  async function routineOwner(sessionId) {
    return sessionId ? await ensureSessionOwner(sessionId) : null;
  }

  async function handleGenerate(body, res, sessionId) {
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    if (!brief || Buffer.byteLength(brief) > MAX_BRIEF_BYTES) return json(res, HTTP_BAD_REQUEST, { error: "generate requires a `brief` string (max 20KB)" });
    if (!sessionId) return json(res, HTTP_BAD_REQUEST, { error: "generate requires a current session" });
    await ensureSessionOwner(sessionId);
    const agent = await spawnRoutineAgent(state, { brief, sessionId });
    return json(res, HTTP_CREATED, { agent: true, output: agent.output, routines: await listRoutines(state) });
  }

  async function handleCreate(body, res, sessionId, name) {
    const script = typeof body.script === "string" ? body.script : null;
    if (!script || Buffer.byteLength(script) > MAX_SCRIPT_BYTES) return json(res, HTTP_BAD_REQUEST, { error: "create requires a `script` string (max 256KB)" });
    const owner = await routineOwner(sessionId);
    return json(res, HTTP_CREATED, { routine: await createRoutine(state, { name, script, sessionId, ownerId: owner?.id ?? null, cwd: await sessionCwd(state, sessionId) }) });
  }

  async function handleStart(res, sessionId, name) {
    const owner = await routineOwner(sessionId);
    return json(res, HTTP_OK, { routine: await startRoutine(state, name, { sessionId, ownerId: owner?.id ?? null, cwd: await sessionCwd(state, sessionId) }) });
  }

  async function dispatchRoutineAction({ action, body, res, sessionId, name }) {
    if (action === "generate") return handleGenerate(body, res, sessionId);
    if (action === "create") return handleCreate(body, res, sessionId, name);
    if (action === "start") return handleStart(res, sessionId, name);
    const operation = { stop: stopRoutine, teardown: teardownRoutine, release: releaseRoutine, delete: deleteRoutine }[action];
    return json(res, HTTP_OK, { routine: await operation(state, name) });
  }

  return {
    "GET /routines": async (_req, res) => {
      disableCaching(res);
      json(res, HTTP_OK, { routines: await listRoutines(state), dir: routinesDir() });
    },

    "POST /routines": async (req, res) => {
      disableCaching(res);
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, HTTP_BAD_REQUEST, { error: "request body must be a JSON object" });
      const action = typeof body.action === "string" ? body.action : "";
      if (!ROUTINE_ACTIONS.has(action)) return json(res, HTTP_BAD_REQUEST, { error: `unknown action: ${action}` });
      let sessionId;
      try { sessionId = sessionIdFromBody(body); }
      catch (error) { return json(res, HTTP_BAD_REQUEST, { error: errorMessage(error) }); }
      const name = action === "generate" ? null : (typeof body.name === "string" ? body.name.trim() : "");
      if (action !== "generate" && !ROUTINE_NAME.test(name)) return json(res, HTTP_BAD_REQUEST, { error: `invalid routine name: ${name}` });
      try { await dispatchRoutineAction({ action, body, res, sessionId, name }); }
      catch (error) { json(res, HTTP_BAD_REQUEST, { error: errorMessage(error) }); }
    },
  };
}
