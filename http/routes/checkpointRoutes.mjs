import { existsSync } from "node:fs";

export function createCheckpointRoutes({ state, config, requestContext, runnerFromReq, checkpointWorkdir, recordCheckpoint, loadCheckpoints, checkpointTree, sessionReferenceFromSearch, git, saveCheckpoints, forkSessionAt, openSessionRunner, sendToRunner, srvId, runnerInfo, logger = console }) {
  const { json, readJsonBody } = requestContext;
  return {
    "POST /checkpoint": async (req, res, url) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const runner = runnerFromReq(url);
      const label = body?.label ? String(body.label).slice(0, 200) : null;
      const model = body?.model ? String(body.model).slice(0, 200) : null;
      const { status, body: out } = await checkpointWorkdir(state.piProcesses, runner.dir, label, model);
      // anchor the checkpoint to the session's latest message (also when the
      // tree was already clean: HEAD marks that state just as well)
      if (status === 200 && out.hash && runner.sessionRef) {
        try {
          const rec = recordCheckpoint(runner.sessionRef, runner.dir, out, { catalog: state.sessionCatalog });
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
      const target = sessionReferenceFromSearch(url);
      if (!target || target.backend !== state.sessionCatalog.backend) {
        json(res, 400, { error: `not a session reference: ${url.searchParams.get("path") ?? url.searchParams.get("key")}` });
        return;
      }
      try {
        json(res, 200, {
          ...checkpointTree(target, { catalog: state.sessionCatalog, sessionReferences: state.sessionReferences }),
          capabilities: {
            rollback: !!state.sessionOperations?.capabilities.exactFork[target.backend],
            reason: state.sessionOperations?.capabilities.exactFork[target.backend]
              ? null
              : `exact-entry ${target.backend} fork is unavailable`,
          },
        });
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
      const sessionRef = cp.sessionRef ?? (cp.sessionPath
        ? { backend: "jsonl", id: sessionId, storagePath: cp.sessionPath }
        : null);
      const backend = sessionRef?.backend;
      if (!sessionRef || !state.sessionOperations?.capabilities.exactFork[backend]) {
        json(res, 409, { error: `${backend ?? "unknown"} rollback requires exact-entry fork support from the configured pi` });
        return;
      }
      if (backend === "jsonl" && !existsSync(sessionRef.storagePath)) {
        json(res, 410, { error: "session file of this checkpoint is gone" }); return;
      }
      if (backend === "sqlite" && !state.sessionCatalog.findById(sessionRef.id)) {
        json(res, 410, { error: "session of this checkpoint is gone" }); return;
      }
      try {
        // 1. nothing may be lost: auto-commit pending changes and record them
        //    as a checkpoint at the session's current tip (→ roll forward later)
        let safety = null;
        const st = await git(cp.dir, ["status", "--porcelain"]);
        if (st.code === 0 && st.stdout.trim()) {
          const saved = await checkpointWorkdir(state.piProcesses, cp.dir, `auto before rollback to ${hash}`, model);
          if (saved.body.committed) {
            safety = saved.body.hash;
            try { recordCheckpoint(sessionRef, cp.dir, saved.body, { catalog: state.sessionCatalog }); } catch {}
          }
        }
        // 2. fork before touching the worktree. Unsupported or failed backend
        //    operations therefore cannot leave git reset to a different state.
        const fork = backend === "sqlite"
          ? await state.sessionOperations.forkSession(sessionRef, { entryId: cp.leafId ?? cp.anchorId, cwd: cp.dir })
          : (() => {
              const created = forkSessionAt(sessionRef.storagePath, cp.leafId ?? cp.anchorId, hash);
              return {
                ...created,
                sessionRef: { backend: "jsonl", id: created.id, storagePath: created.path },
              };
            })();
        const forkEntries = backend === "sqlite"
          ? new Set(state.sessionCatalog.entries(fork.id).entries.map((entry) => entry.id))
          : fork.entryIds;
        // 3. deterministic restore of the checkpointed state
        const rs = await git(cp.dir, ["reset", "--hard", hash]);
        if (rs.code !== 0) {
          json(res, 500, { error: `git reset failed: ${(rs.stderr || rs.stdout).trim()}` });
          return;
        }
        // The fork keeps its ancestors' entry ids: inherit their checkpoints.
        const db = loadCheckpoints();
        db[fork.id] = (db[sessionId] ?? [])
          .filter((checkpoint) => forkEntries.has(checkpoint.anchorId))
          .map((checkpoint) => ({
            ...checkpoint,
            sessionRef: fork.sessionRef,
            ...(backend === "jsonl" ? { sessionPath: fork.path } : { sessionPath: undefined }),
          }));
        saveCheckpoints(db);
        // 4. attach a runner to the fork and hand it to the client
        const runner = openSessionRunner({ sessionRef: fork.sessionRef, dir: cp.dir });
        sendToRunner(runner, { id: srvId(), type: "set_session_name", name: `\u23EA ${hash}` });
        runner.sessionName = `\u23EA ${hash}`; // optimistic — lets the first prompt auto-title the fork right away
        logger.log(`[pi-ui] rolled back ${cp.dir} to ${hash}, forked session ${fork.id}`);
        json(res, 200, {
          rolledBack: hash,
          safety,
          fork: {
            id: fork.id,
            path: fork.path ?? null,
            sessionRef: fork.sessionRef,
            sessionKey: state.sessionReferences.serialize(fork.sessionRef),
          },
          runner: runnerInfo(runner),
        });
      } catch (e) {
        json(res, 500, { error: `rollback failed: ${e.message}` });
      }
    },  };
}
