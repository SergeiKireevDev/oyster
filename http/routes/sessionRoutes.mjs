import { unlinkSync } from "node:fs";
import { resolve } from "node:path";

/** Build saved-session and history routes from the configured catalog. */
export function createSessionRoutes({
  state,
  requestContext,
  sessions,
  runners,
  resources,
  sessionOperations = null,
  deleteOwnedSession = null,
  resolvePath = resolve,
  unlinkFile = unlinkSync,
  logger = console,
}) {
  const { json } = requestContext;
  const { catalog, sessionReferenceFor, sessionTargetFromSearch, readSessionHeaderInfo } = sessions;
  const { stopRunner, runnersChanged } = runners;
  const {
    closeTunnel,
    closeSessionHublots = null,
    listTunnels = () => [],
    stopSessionRoutines = () => [],
    deleteSessionRoutines = resources.releaseSessionRoutines ?? (() => []),
  } = resources;
  const sqlite = catalog.backend === "sqlite";

  function referenceFor(session) {
    return sqlite
      ? state.sessionReferences.validate({ backend: "sqlite", id: session.id, storagePath: catalog.storagePath })
      : sessionReferenceFor(session);
  }

  function decorate(session, byLegacyPath = new Map()) {
    const sessionRef = referenceFor(session);
    let parentSessionKey = null;
    if (sqlite && session.parentSessionId) {
      parentSessionKey = state.sessionReferences.serialize(referenceFor({ id: session.parentSessionId }));
    } else if (session.parentSession && byLegacyPath.has(session.parentSession)) {
      parentSessionKey = state.sessionReferences.serialize(referenceFor(byLegacyPath.get(session.parentSession)));
    }
    return {
      ...session,
      path: sqlite ? null : session.path,
      parentSession: sqlite ? null : (session.parentSession ?? null),
      parentSessionKey,
      sessionRef,
      sessionKey: state.sessionReferences.serialize(sessionRef),
    };
  }

  function requestedIdentity(url) {
    const key = url.searchParams.get("key");
    if (key) {
      try {
        const reference = state.sessionReferences.parse(key);
        return reference.backend === catalog.backend ? (sqlite ? reference.id : reference.storagePath) : null;
      } catch { return null; }
    }
    return sqlite ? null : sessionTargetFromSearch(url);
  }

  return {
    "GET /sessions": (_req, res, url) => {
      let cwd;
      let location;
      if (url.searchParams.get("path")) {
        const requested = resolvePath(String(url.searchParams.get("path")));
        if (sqlite) cwd = requested;
        else {
          location = requested;
          if (location !== catalog.root && !location.startsWith(`${catalog.root}/`)) {
            json(res, 400, { error: "folder must be under the sessions root" });
            return;
          }
        }
      } else if (url.searchParams.get("dir")) cwd = resolvePath(String(url.searchParams.get("dir")));
      else cwd = state.currentDir;

      const summaries = catalog.list({ cwd, location });
      const byLegacyPath = new Map(summaries.filter((session) => session.path).map((session) => [session.path, session]));
      const live = [...state.runners.values()];
      const result = summaries.map((summary) => {
        const session = decorate(summary, byLegacyPath);
        const runner = live.find((candidate) => candidate.sessionRef
          ? state.sessionReferences.equals(candidate.sessionRef, session.sessionRef)
          : candidate.sessionFile === session.path);
        return { ...session, runnerId: runner?.id ?? null, alive: !!runner?.proc, busy: !!runner?.busy };
      });
      json(res, 200, { sessions: result });
    },

    "DELETE /session": async (_req, res, url) => {
      let reference = null;
      const key = url.searchParams.get("key");
      if (key) {
        try {
          const parsed = state.sessionReferences.parse(key);
          if (parsed.backend === catalog.backend) reference = parsed;
        } catch {}
      } else if (!sqlite) {
        const target = sessionTargetFromSearch(url);
        if (target) {
          try {
            const id = readSessionHeaderInfo(target)?.id;
            if (id) reference = referenceFor({ id, path: target });
          } catch {}
        }
      }
      if (!reference) {
        json(res, 400, { error: `not a session reference: ${url.searchParams.get("path") ?? key}` });
        return;
      }
      const operations = sessionOperations ?? {
        capabilities: { delete: { jsonl: true, sqlite: false } },
        async deleteSession(sessionRef) {
          unlinkFile(sessionRef.storagePath);
          return { deleted: sessionRef.storagePath };
        },
      };
      if (!operations.capabilities.delete[reference.backend]) {
        json(res, 409, { error: `${reference.backend} session deletion is not supported by the configured pi` });
        return;
      }
      const matchingRunners = [...state.runners.values()].filter((runner) => runner.sessionRef
        ? state.sessionReferences.equals(runner.sessionRef, reference)
        : reference.backend === "jsonl" && runner.sessionFile === reference.storagePath);
      const workflow = deleteOwnedSession ?? (async (steps) => {
        const stoppedRunners = await steps.stopRunners();
        const agentResult = await steps.deleteAgentSession();
        await steps.removeRuntime(stoppedRunners);
        await steps.broadcast();
        const closedHublots = await steps.closeHublots();
        const deletedRoutines = await steps.deleteRoutines();
        return { agentResult, closedHublots, stoppedRoutines: deletedRoutines, deletedRoutines };
      });
      try {
        const outcome = await workflow({
          reference,
          stopRunners: () => { for (const runner of matchingRunners) stopRunner(runner); return matchingRunners; },
          closeHublots: async () => {
            if (closeSessionHublots) return closeSessionHublots(state, reference.id);
            const closed = [];
            for (const tunnel of listTunnels(state)) {
              if (tunnel.sessionId !== reference.id) continue;
              closeTunnel(state, tunnel.id);
              closed.push(tunnel.port);
              logger.log(`[pi-ui] closed hublot :${tunnel.port} (session ${reference.id} deleted)`);
            }
            return closed;
          },
          stopRoutines: () => stopSessionRoutines(state, reference.id),
          deleteRoutines: () => deleteSessionRoutines(state, reference.id),
          deleteAgentSession: () => operations.deleteSession(reference),
          removeRuntime: (stoppedRunners) => {
            for (const runner of stoppedRunners) {
              state.runners.delete(runner.id);
              if (state.defaultRunnerId === runner.id) {
                state.defaultRunnerId = null;
                state.appSettings?.setDefaultRunnerId(null);
              }
            }
          },
          broadcast: () => runnersChanged(),
        });
        json(res, 200, {
          deleted: outcome.agentResult.deleted,
          closedHublots: outcome.closedHublots,
          releasedRoutines: outcome.deletedRoutines,
        });
      } catch (error) {
        const status = error.code === "capability_unavailable" ? 409 : 500;
        json(res, status, { error: `failed to delete session: ${error.message}` });
      }
    },

    "GET /session-by-id": (_req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, 400, { error: "id required" }); return; }
      try {
        const session = catalog.findById(id);
        if (!session) { json(res, 404, { error: `no session with id ${id}` }); return; }
        json(res, 200, { session: decorate(session) });
      } catch (error) {
        json(res, 500, { error: `failed to read session: ${error.message}` });
      }
    },

    "GET /session-entries": (_req, res, url) => {
      const identity = requestedIdentity(url);
      if (!identity) { json(res, 404, { error: "session not found" }); return; }
      try { json(res, 200, catalog.entries(identity)); }
      catch (error) { json(res, 500, { error: `failed to parse session: ${error.message}` }); }
    },

    "GET /session-messages": (_req, res, url) => {
      const identity = requestedIdentity(url);
      if (!identity) { json(res, 404, { error: "session not found" }); return; }
      try { json(res, 200, catalog.messages(identity)); }
      catch (error) { json(res, 500, { error: `failed to parse session: ${error.message}` }); }
    },

    "GET /session-folders": (_req, res, url) => {
      const forDir = url.searchParams.get("dir") ? resolvePath(String(url.searchParams.get("dir"))) : state.currentDir;
      json(res, 200, { folders: catalog.folders(), current: catalog.locationForCwd(forDir) });
    },

    "GET /search": (_req, res, url) => {
      const query = String(url.searchParams.get("q") ?? "").trim();
      const scope = String(url.searchParams.get("scope") ?? "folder");
      const rawPath = url.searchParams.get("path");
      const key = url.searchParams.get("key");
      let path = rawPath ? resolvePath(String(rawPath)) : null;
      let sessionIdentity = null;
      if (key) {
        try {
          const reference = state.sessionReferences.parse(key);
          if (reference.backend === catalog.backend) sessionIdentity = sqlite ? reference.id : reference.storagePath;
        } catch {}
      }
      if (query.length < 2) { json(res, 400, { error: "query must be at least 2 characters" }); return; }
      if (!["session", "folder", "all"].includes(scope)) { json(res, 400, { error: `invalid scope: ${scope}` }); return; }
      if (scope === "session") {
        if (sqlite && !sessionIdentity) { json(res, 400, { error: "scope=session requires a session key" }); return; }
        if (!sqlite && sessionIdentity) path = sessionIdentity;
        if (!sqlite && (!path || !path.startsWith(`${catalog.root}/`) || !path.endsWith(".jsonl"))) {
          json(res, 400, { error: "scope=session requires a session file path" }); return;
        }
      }
      if (scope === "folder" && !sqlite && path && path !== catalog.root && !path.startsWith(`${catalog.root}/`)) {
        json(res, 400, { error: "folder must be under the sessions root" }); return;
      }
      try {
        const result = catalog.search(sqlite ? {
          q: query,
          scope,
          path: scope === "session" ? sessionIdentity : path,
          cwd: path ?? state.currentDir,
          includeTools: url.searchParams.get("tools") === "1",
        } : {
          q: query,
          scope,
          path,
          includeTools: url.searchParams.get("tools") === "1",
          defaultDir: catalog.locationForCwd(state.currentDir),
        });
        result.results = result.results.map((hit) => {
          const source = sqlite ? { id: hit.sessionId } : { id: hit.sessionId, path: hit.sessionPath };
          const sessionRef = referenceFor(source);
          return { ...hit, sessionRef, sessionKey: state.sessionReferences.serialize(sessionRef) };
        });
        json(res, 200, { q: query, scope, ...result });
      } catch (error) {
        json(res, 500, { error: `search failed: ${error.message}` });
      }
    },
  };
}
