import { statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_PATH_BYTES = 16 * 1024;

function isJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Build the route that selects and persists the active working directory. */
export function createWorkdirRoutes({ state, requestContext, spawnRunner, runnerInfo, logger = console } = {}) {
  if (!state || typeof state !== "object") throw new TypeError("state is required");
  if (!requestContext || typeof requestContext.json !== "function"
    || typeof requestContext.readJsonBody !== "function"
    || typeof requestContext.resolveSafePath !== "function") {
    throw new TypeError("requestContext is required");
  }
  if (typeof spawnRunner !== "function") throw new TypeError("spawnRunner is required");
  if (typeof runnerInfo !== "function") throw new TypeError("runnerInfo is required");
  if (state.appSettings != null && typeof state.appSettings.setCurrentWorkdir !== "function") {
    throw new TypeError("state.appSettings.setCurrentWorkdir must be a function");
  }

  const { json, readJsonBody, resolveSafePath } = requestContext;
  const log = (message) => {
    try { logger?.log?.(message); } catch { /* Logging must not change a completed state transition. */ }
  };

  return {
    "POST /workdir": async (req, res) => {
      res.setHeader?.("cache-control", "no-store");
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!isJsonObject(body)) {
        json(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      if (typeof body.path !== "string" || !body.path.trim()) {
        json(res, 400, { error: "path must be a non-empty string" });
        return;
      }
      if (body.path.includes("\0") || Buffer.byteLength(body.path) > MAX_PATH_BYTES) {
        json(res, 400, { error: "path must not contain null bytes or exceed 16 KiB" });
        return;
      }

      const target = resolveSafePath(resolve(body.path));
      if (!target) {
        json(res, 403, { error: `path outside the allowed roots: ${body.path}` });
        return;
      }
      let directory = false;
      try { directory = statSync(target).isDirectory(); } catch { /* Report inaccessible paths uniformly. */ }
      if (!directory) {
        json(res, 400, { error: `not a directory: ${target}` });
        return;
      }

      await state.appSettings?.setCurrentWorkdir(target);
      state.currentDir = target;
      log(`[oyster] workdir changed to ${JSON.stringify(target)}, spawning a runner there`);
      const runner = await spawnRunner({ dir: target });
      json(res, 200, { workdir: target, runner: runnerInfo(runner) });
    },
  };
}
