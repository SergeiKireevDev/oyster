import { existsSync } from "node:fs";

export function createCheckpointRoutes({ state, config, requestContext, runnerFromReq, checkpointWorkdir, recordCheckpoint, loadCheckpoints, checkpointTree, sessionFileParam, logger = console }) {
  const { json, readJsonBody } = requestContext;
  return {
    "POST /checkpoint": async (req, res, url) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const runner = runnerFromReq(url);
      const label = body?.label ? String(body.label).slice(0, 200) : null;
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const { status, body: out } = await checkpointWorkdir(config.PI_BIN, runner.dir, label, model);
      // anchor the checkpoint to the session's latest message (also when the
      // tree was already clean: HEAD marks that state just as well)
      if (status === 200 && out.hash && runner.sessionFile && existsSync(runner.sessionFile)) {
        try {
          const rec = recordCheckpoint(runner.sessionFile, runner.dir, out);
          if (rec) { out.recorded = true; out.anchorId = rec.anchorId; }
        } catch (e) {
          logger.error(`[pi-ui] failed to record checkpoint: ${e.message}`);
        }
      }
      json(res, status, out);
    },

    "GET /checkpoints": (req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { checkpoints: loadCheckpoints()[id] ?? [] });
    },

    "GET /checkpoint-tree": (req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        json(res, 200, checkpointTree(target));
      } catch (e) {
        json(res, 500, { error: `tree failed: ${e.message}` });
      }
    },

  };
}
