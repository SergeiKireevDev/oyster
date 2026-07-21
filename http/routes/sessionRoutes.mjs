import { unlinkSync } from "node:fs";
import { resolve } from "node:path";

/** Build saved-session and history routes from injected domain operations. */
export function createSessionRoutes({
  state,
  requestContext,
  sessions,
  runners,
  resources,
  resolvePath = resolve,
  unlinkFile = unlinkSync,
  logger = console,
}) {
  const { json } = requestContext;
  const {
    root,
    sessionDirFor,
    summarizeSessionFile,
    listSessions,
    listSessionFolders,
    sessionEntries,
    sessionMessages,
    findSessionById,
    readSessionHeaderInfo,
    sessionFileParam,
    sessionFileFromSearch,
  } = sessions;
  const { stopRunner, runnersChanged } = runners;
  const { closeTunnel, releaseSessionRoutines } = resources;

  return {
    "GET /sessions": (_req, res, url) => {
      let dir;
      if (url.searchParams.get("path")) {
        dir = resolvePath(String(url.searchParams.get("path")));
        if (dir !== root && !dir.startsWith(`${root}/`)) {
          json(res, 400, { error: "folder must be under the sessions root" });
          return;
        }
      } else if (url.searchParams.get("dir")) {
        dir = sessionDirFor(resolvePath(String(url.searchParams.get("dir"))));
      }
      const live = [...state.runners.values()];
      const result = listSessions(dir ?? sessionDirFor(state.currentDir)).map((session) => {
        const runner = live.find((candidate) => candidate.sessionFile === session.path);
        return { ...session, runnerId: runner?.id ?? null, alive: !!runner?.proc, busy: !!runner?.busy };
      });
      json(res, 200, { sessions: result });
    },

    "DELETE /session": (_req, res, url) => {
      const target = sessionFileParam(url.searchParams.get("path"));
      if (!target) {
        json(res, 400, { error: `not a session file: ${url.searchParams.get("path")}` });
        return;
      }
      try {
        for (const runner of [...state.runners.values()]) {
          if (runner.sessionFile === target) {
            stopRunner(runner);
            state.runners.delete(runner.id);
            if (state.defaultRunnerId === runner.id) state.defaultRunnerId = null;
          }
        }
        runnersChanged();
        let sessionId = null;
        try { sessionId = readSessionHeaderInfo(target)?.id ?? null; } catch {}
        const closedHublots = [];
        if (sessionId) {
          for (const tunnel of [...(state.tunnels?.values() ?? [])]) {
            if (tunnel.sessionId === sessionId) {
              closeTunnel(state, tunnel.id);
              closedHublots.push(tunnel.port);
              logger.log(`[pi-ui] closed hublot :${tunnel.port} (session ${sessionId} deleted)`);
            }
          }
        }
        const releasedRoutines = sessionId ? releaseSessionRoutines(state, sessionId) : [];
        unlinkFile(target);
        json(res, 200, { deleted: target, closedHublots, releasedRoutines });
      } catch (error) {
        json(res, 500, { error: `failed to delete session: ${error.message}` });
      }
    },

    "GET /session-by-id": (_req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) {
        json(res, 400, { error: "id required" });
        return;
      }
      const path = findSessionById(id);
      if (!path) {
        json(res, 404, { error: `no session with id ${id}` });
        return;
      }
      try {
        json(res, 200, { session: { path, ...summarizeSessionFile(path) } });
      } catch (error) {
        json(res, 500, { error: `failed to read session: ${error.message}` });
      }
    },

    "GET /session-entries": (_req, res, url) => {
      const target = sessionFileFromSearch(url);
      if (!target) {
        json(res, 404, { error: "session file not found" });
        return;
      }
      try {
        json(res, 200, sessionEntries(target));
      } catch (error) {
        json(res, 500, { error: `failed to parse session: ${error.message}` });
      }
    },

    "GET /session-messages": (_req, res, url) => {
      const target = sessionFileFromSearch(url);
      if (!target) {
        json(res, 404, { error: "session file not found" });
        return;
      }
      try {
        json(res, 200, sessionMessages(target));
      } catch (error) {
        json(res, 500, { error: `failed to parse session: ${error.message}` });
      }
    },

    "GET /session-folders": (_req, res, url) => {
      const forDir = url.searchParams.get("dir")
        ? resolvePath(String(url.searchParams.get("dir")))
        : state.currentDir;
      json(res, 200, { folders: listSessionFolders(), current: sessionDirFor(forDir) });
    },
  };
}
