import { errorMessage } from "../../errors.mjs";
import { disableCaching } from "../createRequestContext.mjs";

const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HEARTBEAT_INTERVAL_MS = 25_000;
const NDJSON = "application/x-ndjson";

function errorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : HTTP_INTERNAL_SERVER_ERROR;
}

/**
 * Plan loops over HTTP.
 *
 * `POST /loops` runs a loop to its end. Callers that accept NDJSON get
 * `started`, `progress`, `heartbeat`, and a terminal `complete` event as the
 * loop advances, and cancel the loop by disconnecting; other callers get the
 * final result as one JSON body.
 */
export function createLoopRoutes({
  requestContext, loops, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
}) {
  if (!requestContext || typeof requestContext.json !== "function" || typeof requestContext.readJsonBody !== "function") {
    throw new TypeError("requestContext response and JSON body helpers are required");
  }
  for (const method of ["validate", "run", "isRunning", "list"]) {
    if (typeof loops?.[method] !== "function") throw new TypeError(`loop service requires ${method}()`);
  }
  const { json, readJsonBody } = requestContext;

  async function streamLoop(inputs, res) {
    const writeEvent = (event) => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    res.writeHead(HTTP_OK, {
      "content-type": `${NDJSON}; charset=utf-8`,
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on?.("close", cancel);
    const heartbeat = setIntervalImpl(() => writeEvent({ type: "heartbeat", timestamp: Date.now() }), HEARTBEAT_INTERVAL_MS);
    heartbeat?.unref?.();
    let terminal;
    try {
      const result = await loops.run(inputs, {
        signal: controller.signal,
        onStarted: (loop) => writeEvent({ type: "started", loop }),
        onProgress: (event) => writeEvent({ type: "progress", ...event }),
      });
      terminal = { type: "complete", ...result };
    } catch (error) {
      terminal = { type: "complete", complete: false, reason: "error", message: errorMessage(error) };
    } finally {
      clearIntervalImpl(heartbeat);
      res.off?.("close", cancel);
    }
    writeEvent(terminal);
    if (!res.writableEnded && !res.destroyed) res.end();
  }

  return {
    "GET /loops": async (_req, res) => {
      disableCaching(res);
      json(res, HTTP_OK, { loops: loops.list() });
    },

    "POST /loops": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      let inputs;
      try {
        inputs = loops.validate(body);
        if (loops.isRunning(inputs.dir)) throw Object.assign(new Error(`a loop is already running in ${inputs.dir}`), { status: HTTP_CONFLICT });
      } catch (error) {
        json(res, errorStatus(error), { error: errorMessage(error) });
        return;
      }
      if (String(req.headers?.accept ?? "").includes(NDJSON)) {
        await streamLoop(inputs, res);
        return;
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.on?.("close", cancel);
      try {
        json(res, HTTP_OK, await loops.run(inputs, { signal: controller.signal }));
      } catch (error) {
        json(res, errorStatus(error), { error: errorMessage(error) });
      } finally {
        res.off?.("close", cancel);
      }
    },
  };
}
