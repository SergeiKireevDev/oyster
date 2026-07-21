import { statSync } from "node:fs";
import { resolve } from "node:path";

export function createWorkdirRoutes({ state, requestContext, spawnRunner, runnerInfo, logger = console }) {
  const { json, readJsonBody, resolveSafePath } = requestContext;
  return {
    "POST /workdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = resolveSafePath(resolve(String(body?.path ?? "")));
      if (!target) {
        json(res, 403, { error: `path outside the allowed roots: ${body?.path}` });
        return;
      }
      let directory = false;
      try { directory = statSync(target).isDirectory(); } catch {}
      if (!directory) { json(res, 400, { error: `not a directory: ${target}` }); return; }
      state.currentDir = target;
      logger.log(`[pi-ui] workdir changed to ${target}, spawning a runner there`);
      const runner = spawnRunner({ dir: target });
      json(res, 200, { workdir: target, runner: runnerInfo(runner) });
    },
  };
}
