import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const MAX_METADATA_LENGTH = 200;

function optionalMetadata(value) {
  return value ? String(value).slice(0, MAX_METADATA_LENGTH) : null;
}

import { errorMessage } from "../../errors.mjs";

function workdirLockKey(dir) {
  if (typeof dir !== "string" || !dir) return null;
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

async function withWorkdirLock(state, res, json, dir, operation) {
  const key = workdirLockKey(dir);
  if (!key) {
    json(res, 500, { error: "checkpoint has no valid work directory" });
    return;
  }
  const locks = (state.checkpointWorkdirLocks ??= new Set());
  if (locks.has(key)) {
    json(res, 409, { error: "another checkpoint operation is already running in this work directory" });
    return;
  }
  locks.add(key);
  try {
    await operation();
  } finally {
    locks.delete(key);
  }
}

function parseRollbackRequest(body) {
  const sessionId = String(body?.sessionId ?? "").trim();
  const hash = String(body?.hash ?? "").trim();
  if (!sessionId || !hash) return { error: "sessionId and hash are required" };
  return { sessionId, hash, model: optionalMetadata(body?.model) };
}

async function loadRollbackCheckpoint(repository, state, sessionId, hash) {
  const checkpoint = await repository.findBySessionId(sessionId, state.sessionCatalog.backend, hash);
  if (!checkpoint) return { status: 404, body: { error: "no such checkpoint" } };
  const sessionRef = checkpoint.sessionRef ?? (checkpoint.sessionPath
    ? { backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath }
    : null);
  return { checkpoint, sessionRef, backend: sessionRef?.backend };
}

async function ensureRollbackTargetAvailable(state, sessionRef, backend) {
  if (!sessionRef || !state.sessionOperations?.capabilities?.exactFork?.[backend]) {
    return { status: 409, body: { error: `${backend ?? "unknown"} rollback requires exact-entry fork support from the configured pi` } };
  }
  if (backend === "jsonl" && !existsSync(sessionRef.storagePath)) {
    return { status: 410, body: { error: "session file of this checkpoint is gone" } };
  }
  if (backend === "sqlite" && !await state.sessionCatalog.findById(sessionRef.id)) {
    return { status: 410, body: { error: "session of this checkpoint is gone" } };
  }
  return null;
}

async function createSafetyCheckpointIfNeeded({ state, git, checkpointWorkdir, recordCheckpoint, repository, sessionRef, checkpoint, hash, model }) {
  const status = await git(checkpoint.dir, ["status", "--porcelain"]);
  if (status.code !== 0) throw new Error(`git status failed: ${(status.stderr || status.stdout).trim()}`);
  if (!status.stdout.trim()) return null;

  const saved = await checkpointWorkdir(state.piProcesses, checkpoint.dir, `auto before rollback to ${hash}`, model);
  if (saved.status !== 200 || !saved.body?.committed || !saved.body.hash) {
    throw new Error(`safety checkpoint failed: ${saved.body?.error ?? "worktree changes were not committed"}`);
  }
  const safetyRecord = await recordCheckpoint(sessionRef, checkpoint.dir, saved.body, {
    catalog: state.sessionCatalog,
    repository,
  });
  if (!safetyRecord) throw new Error("safety checkpoint could not be associated with the session");
  return saved.body.hash;
}

async function forkRollbackSession({ state, forkSessionAt, ensureSessionOwner, sessionRef, backend, checkpoint, hash }) {
  const fork = backend === "sqlite"
    ? await state.sessionOperations.forkSession(sessionRef, {
        entryId: checkpoint.leafId ?? checkpoint.anchorId,
        cwd: checkpoint.dir,
      })
    : (() => {
        const created = forkSessionAt(sessionRef.storagePath, checkpoint.leafId ?? checkpoint.anchorId, hash);
        return {
          ...created,
          sessionRef: { backend: "jsonl", id: created.id, storagePath: created.path },
        };
      })();
  await ensureSessionOwner(fork.sessionRef);
  const forkEntries = backend === "sqlite"
    ? new Set((await state.sessionCatalog.entries(fork.id)).entries.map((entry) => entry.id))
    : fork.entryIds;
  return { fork, forkEntries };
}

async function resetWorktreeToCheckpoint({ git, checkpoint, hash, rollbackOperation, json, res }) {
  const reset = await git(checkpoint.dir, ["reset", "--hard", hash]);
  if (reset.code === 0) return null;
  const error = new Error(`git reset failed: ${(reset.stderr || reset.stdout).trim()}`);
  await rollbackOperation.fail(error);
  json(res, 500, { error: error.message });
  return error;
}

async function inheritCheckpointsForFork({ repository, sessionRef, backend, fork, forkEntries }) {
  const inheritedCheckpoints = (await repository.listForSession(sessionRef))
    .filter((item) => forkEntries.has(item.anchorId))
    .map((item) => ({
      ...item,
      sessionRef: fork.sessionRef,
      ...(backend === "jsonl" ? { sessionPath: fork.path } : { sessionPath: undefined }),
    }));
  await repository.replaceForSession(fork.sessionRef, inheritedCheckpoints);
  return inheritedCheckpoints.length;
}

async function openRollbackRunner({ openSessionRunner, checkpoint, fork }) {
  return openSessionRunner({ sessionRef: fork.sessionRef, dir: checkpoint.dir });
}

async function runRollbackWorkflow({
  state, repository, checkpointRollbackJournal, checkpointWorkdir, recordCheckpoint, git,
  forkSessionAt, openSessionRunner, sendToRunner, srvId, runnerInfo, ensureSessionOwner,
  logger, json, res, checkpoint, sessionRef, backend, hash, model,
}) {
  let rollbackOperation = null;
  try {
    rollbackOperation = await checkpointRollbackJournal.start({ reference: sessionRef, hash, dir: checkpoint.dir });
    const safety = await createSafetyCheckpointIfNeeded({
      state, git, checkpointWorkdir, recordCheckpoint, repository, sessionRef, checkpoint, hash, model,
    });
    await rollbackOperation.advance("safety_checkpointed", { safetyHash: safety });

    // Fork before touching the worktree. Unsupported or failed backend
    // operations therefore cannot leave Git reset to another state.
    const { fork, forkEntries } = await forkRollbackSession({
      state, forkSessionAt, ensureSessionOwner, sessionRef, backend, checkpoint, hash,
    });
    await rollbackOperation.advance("session_forked", { forkReference: fork.sessionRef });

    if (await resetWorktreeToCheckpoint({ git, checkpoint, hash, rollbackOperation, json, res })) return;
    await rollbackOperation.advance("git_reset", { resetHash: hash });

    const inheritedCheckpointCount = await inheritCheckpointsForFork({ repository, sessionRef, backend, fork, forkEntries });
    await rollbackOperation.advance("inheritance_recorded", { inheritedCheckpointCount });

    const runner = await openRollbackRunner({ openSessionRunner, checkpoint, fork });
    await rollbackOperation.advance("runner_opened", { runnerId: runner.id });
    const sessionName = `\u23EA ${hash}`;
    await sendToRunner(runner, { id: srvId(), type: "set_session_name", name: sessionName });
    // Optimistic: lets the first prompt auto-title the fork immediately.
    runner.sessionName = sessionName;
    logger.log(`[oyster] rolled back ${checkpoint.dir} to ${hash}, forked session ${fork.id}`);
    await rollbackOperation.complete();
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
  } catch (error) {
    if (rollbackOperation && rollbackOperation.stage !== "completed") {
      try {
        await rollbackOperation.fail(error);
      } catch {
        // Preserve the original rollback failure.
      }
    }
    json(res, 500, { error: `rollback failed: ${errorMessage(error)}` });
  }
}

export function createCheckpointRoutes({
  state,
  requestContext,
  runnerFromReq,
  checkpointWorkdir,
  recordCheckpoint,
  checkpointRepository: repository,
  checkpointRollbackJournal,
  checkpointTree,
  sessionReferenceFromSearch,
  git,
  forkSessionAt,
  openSessionRunner,
  sendToRunner,
  srvId,
  runnerInfo,
  ensureSessionOwner = () => null,
  logger = console,
}) {
  if (!repository) throw new Error("checkpoint repository is required");
  if (!checkpointRollbackJournal) throw new Error("checkpoint rollback journal is required");
  const { json, readJsonBody } = requestContext;

  return {
    "POST /checkpoint": async (req, res, url) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const runner = await runnerFromReq(url);
      const label = optionalMetadata(body?.label);
      const model = optionalMetadata(body?.model);

      await withWorkdirLock(state, res, json, runner.dir, async () => {
        try {
          const result = await checkpointWorkdir(state.piProcesses, runner.dir, label, model);
          const out = { ...result.body };
          // Anchor the checkpoint to the session's latest message. When the
          // tree was already clean, HEAD identifies that state just as well.
          if (result.status === 200 && out.hash && runner.sessionRef) {
            try {
              await ensureSessionOwner(runner.sessionRef);
              const record = await recordCheckpoint(runner.sessionRef, runner.dir, out, {
                catalog: state.sessionCatalog,
                repository,
              });
              if (record) {
                out.recorded = true;
                out.anchorId = record.anchorId;
              }
            } catch (error) {
              out.recorded = false;
              out.warning = "checkpoint created but could not be associated with the session";
              logger.error(`[oyster] failed to record checkpoint: ${errorMessage(error)}`);
            }
          }
          json(res, result.status, out);
        } catch (error) {
          logger.error(`[oyster] checkpoint failed: ${errorMessage(error)}`);
          json(res, 500, { error: `checkpoint failed: ${errorMessage(error)}` });
        }
      });
    },

    "GET /checkpoints": async (req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) {
        json(res, 400, { error: "id required" });
        return;
      }
      json(res, 200, { checkpoints: await repository.listBySessionId(id, state.sessionCatalog.backend) });
    },

    "GET /checkpoint-tree": async (req, res, url) => {
      const target = sessionReferenceFromSearch(url);
      if (!target || target.backend !== state.sessionCatalog.backend) {
        json(res, 400, { error: `not a session reference: ${url.searchParams.get("path") ?? url.searchParams.get("key")}` });
        return;
      }
      try {
        const canRollback = Boolean(state.sessionOperations?.capabilities?.exactFork?.[target.backend]);
        json(res, 200, {
          ...await checkpointTree(target, {
            catalog: state.sessionCatalog,
            sessionReferences: state.sessionReferences,
            repository,
          }),
          capabilities: {
            rollback: canRollback,
            reason: canRollback ? null : `exact-entry ${target.backend} fork is unavailable`,
          },
        });
      } catch (error) {
        json(res, 500, { error: `tree failed: ${errorMessage(error)}` });
      }
    },

    "POST /rollback": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const request = parseRollbackRequest(body);
      if (request.error) {
        json(res, 400, { error: request.error });
        return;
      }
      const loaded = await loadRollbackCheckpoint(repository, state, request.sessionId, request.hash);
      if (loaded.status) {
        json(res, loaded.status, loaded.body);
        return;
      }
      const unavailable = await ensureRollbackTargetAvailable(state, loaded.sessionRef, loaded.backend);
      if (unavailable) {
        json(res, unavailable.status, unavailable.body);
        return;
      }

      await withWorkdirLock(state, res, json, loaded.checkpoint.dir, () => runRollbackWorkflow({
        state,
        repository,
        checkpointRollbackJournal,
        checkpointWorkdir,
        recordCheckpoint,
        git,
        forkSessionAt,
        openSessionRunner,
        sendToRunner,
        srvId,
        runnerInfo,
        ensureSessionOwner,
        logger,
        json,
        res,
        checkpoint: loaded.checkpoint,
        sessionRef: loaded.sessionRef,
        backend: loaded.backend,
        hash: request.hash,
        model: request.model,
      }));
    },
  };
}
