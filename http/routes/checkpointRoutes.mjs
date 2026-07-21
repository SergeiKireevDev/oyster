import { existsSync } from "node:fs";

export function createCheckpointRoutes({ state, config, requestContext, runnerFromReq, checkpointWorkdir, recordCheckpoint, loadCheckpoints, checkpointTree, sessionFileParam, git, saveCheckpoints, forkSessionAt, openSessionRunner, sendToRunner, srvId, runnerInfo, logger = console }) {
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
      const target = sessionFileParam(url);
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

    "POST /rollback": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const sessionId = String(body?.sessionId ?? "").trim();
      const hash = String(body?.hash ?? "").trim();
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const cp = (loadCheckpoints()[sessionId] ?? []).find((c) => c.hash === hash);
      if (!cp) { json(res, 404, { error: "no such checkpoint" }); return; }
      if (!existsSync(cp.sessionPath)) { json(res, 410, { error: "session file of this checkpoint is gone" }); return; }
      try {
        // 1. nothing may be lost: auto-commit pending changes and record them
        //    as a checkpoint at the session's current tip (→ roll forward later)
        let safety = null;
        const st = await git(cp.dir, ["status", "--porcelain"]);
        if (st.code === 0 && st.stdout.trim()) {
          const saved = await checkpointWorkdir(config.PI_BIN, cp.dir, `auto before rollback to ${hash}`, model);
          if (saved.body.committed) {
            safety = saved.body.hash;
            try { recordCheckpoint(cp.sessionPath, cp.dir, saved.body); } catch {}
          }
        }
        // 2. deterministic restore of the checkpointed state
        const rs = await git(cp.dir, ["reset", "--hard", hash]);
        if (rs.code !== 0) {
          json(res, 500, { error: `git reset failed: ${(rs.stderr || rs.stdout).trim()}` });
          return;
        }
        // 3. fork the session at the checkpointed entry — no LLM involved
        const fork = forkSessionAt(cp.sessionPath, cp.leafId ?? cp.anchorId, hash);
        // the fork keeps its ancestors' entry ids: inherit their checkpoints
        const db = loadCheckpoints();
        db[fork.id] = (db[sessionId] ?? [])
          .filter((c) => fork.entryIds.has(c.anchorId))
          .map((c) => ({ ...c, sessionPath: fork.path }));
        saveCheckpoints(db);
        // 4. attach a runner to the fork and hand it to the client
        const runner = openSessionRunner({ sessionPath: fork.path, sessionId: fork.id, dir: cp.dir });
        sendToRunner(runner, { id: srvId(), type: "set_session_name", name: `\u23EA ${hash}` });
        runner.sessionName = `\u23EA ${hash}`; // optimistic — lets the first prompt auto-title the fork right away
        logger.log(`[pi-ui] rolled back ${cp.dir} to ${hash}, forked session ${fork.id}`);
        json(res, 200, { rolledBack: hash, safety, fork: { id: fork.id, path: fork.path }, runner: runnerInfo(runner) });
      } catch (e) {
        json(res, 500, { error: `rollback failed: ${e.message}` });
      }
    },  };
}
