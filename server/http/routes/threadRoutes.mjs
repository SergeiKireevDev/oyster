import { errorMessage } from "../../errors.mjs";
import { disableCaching } from "../createRequestContext.mjs";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const INVALID_SESSION_ERROR = "a valid session key is required";

/** Thread creation, family listing and deletion over the thread service. */
export function createThreadRoutes({ state, requestContext, threads, deleteSession }) {
  if (!state?.sessionReferences || typeof state.sessionReferences.parse !== "function") {
    throw new TypeError("state with session reference operations is required");
  }
  if (!requestContext || typeof requestContext.json !== "function" || typeof requestContext.readJsonBody !== "function") {
    throw new TypeError("requestContext response and JSON body helpers are required");
  }
  for (const method of ["tree", "create", "find", "sessionReference", "forget"]) {
    if (typeof threads?.[method] !== "function") throw new TypeError(`thread service requires ${method}()`);
  }
  if (typeof deleteSession !== "function") throw new TypeError("deleteSession must be a function");

  const { json, readJsonBody } = requestContext;

  function parseSessionKey(key) {
    try { return state.sessionReferences.parse(String(key ?? "")); }
    catch { return null; }
  }

  function fail(res, error, action) {
    const status = Number.isInteger(error?.status) ? error.status : HTTP_INTERNAL_SERVER_ERROR;
    if (status === HTTP_INTERNAL_SERVER_ERROR) console.error(`[oyster] cannot ${action}: ${errorMessage(error)}`);
    json(res, status, { error: errorMessage(error) });
  }

  return {
    // The family a session belongs to: its root plus every thread under it.
    "GET /threads": async (_req, res, url) => {
      const reference = parseSessionKey(url.searchParams.get("key"));
      if (!reference) { json(res, HTTP_BAD_REQUEST, { error: INVALID_SESSION_ERROR }); return; }
      try {
        disableCaching(res);
        json(res, HTTP_OK, await threads.tree(reference));
      } catch (error) { fail(res, error, "list threads"); }
    },

    "POST /threads": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const reference = parseSessionKey(body?.sessionKey);
      if (!reference) { json(res, HTTP_BAD_REQUEST, { error: INVALID_SESSION_ERROR }); return; }
      try { json(res, HTTP_CREATED, await threads.create(reference, body)); }
      catch (error) { fail(res, error, "create thread"); }
    },

    // Deleting a thread deletes its session and, through the session route, every thread beneath it.
    "DELETE /threads": async (_req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "");
      try {
        const row = id ? await threads.find(id) : null;
        if (!row) { json(res, HTTP_NOT_FOUND, { error: "no such thread" }); return; }
        const sessionKey = state.sessionReferences.serialize(threads.sessionReference(row));
        const outcome = await deleteSession(sessionKey);
        if (outcome.status !== HTTP_OK) { json(res, outcome.status, outcome.data ?? { error: "failed to delete thread" }); return; }
        threads.forget([id]);
        json(res, HTTP_OK, { deleted: id, parentSessionKey: threads.describe(row).parentSessionKey });
      } catch (error) { fail(res, error, "delete thread"); }
    },
  };
}
