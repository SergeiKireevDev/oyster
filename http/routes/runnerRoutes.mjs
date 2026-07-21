import { statSync } from "node:fs";
import { resolve } from "node:path";

/** Build runner process, SSE, and RPC routes from stable-state operations. */
export function createRunnerRoutes({
  state,
  runnerFromReq,
  startRunner,
  listRunnerInfo,
  requestContext,
  sendToRunner,
  stopRunner,
  runnerInfo,
  replayRunnerEvents = () => [],
  openSessionRunner,
  sessionReferenceParam,
  lookupSessionReference = () => ({}),
  srvId,
  runnersChanged,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  resolvePath = resolve,
  isDirectory = (path) => statSync(path).isDirectory(),
}) {
  const json = requestContext?.json;
  const readJsonBody = requestContext?.readJsonBody;
  const resolveSafePath = requestContext?.resolveSafePath;

  function autoTitleFork(runner, command) {
    if (command.type !== "prompt" || typeof command.message !== "string") return;
    if (!/^\u23EA [0-9a-f]{4,12}$/.test(runner.sessionName ?? "")) return;
    const title = command.message.replace(/\s+/g, " ").trim();
    if (!title) return;
    const short = title.length > 42 ? `${title.slice(0, 41).trimEnd()}…` : title;
    sendToRunner(runner, { id: srvId(), type: "set_session_name", name: `⏪ ${short}` }, { autostart: false });
    runner.sessionName = `⏪ ${short}`;
    runnersChanged();
  }

  return {
    "GET /events": (req, res, url) => {
      const runner = runnerFromReq(url);
      if (!runner.proc) startRunner(runner);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`: connected ${" ".repeat(2048)}\n\n`);
      res.runnerId = runner.id;
      state.sseClients.add(res);

      let ping = null;
      req.on("close", () => {
        if (ping) clearIntervalImpl(ping);
        state.sseClients.delete(res);
      });

      if (url.searchParams.get("replay") !== "0") {
        for (const line of replayRunnerEvents(runner)) res.write(`data: ${line}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "replay_done",
        _server: true,
        runner: runner.id,
        piRunning: !!runner.proc,
        workdir: runner.dir,
        runners: listRunnerInfo(),
      })}\n\n`);
      ping = setIntervalImpl(
        () => res.write(`data: ${JSON.stringify({ type: "ping", _server: true, runners: listRunnerInfo() })}\n\n`),
        25000,
      );
    },

    "POST /rpc": async (req, res, url) => {
      const command = await readJsonBody(req, res);
      if (command === undefined) return;
      if (!command || typeof command !== "object" || typeof command.type !== "string") {
        json(res, 400, { error: "command must be an object with a string `type`" });
        return;
      }
      const runner = runnerFromReq(url);
      const queued = sendToRunner(runner, command);
      if (queued) autoTitleFork(runner, command);
      json(res, queued ? 202 : 503, queued
        ? { queued: true, runner: runner.id, ...(runner.resumeId ? { pendingResume: true } : {}) }
        : { error: "pi process unavailable" });
    },

    "GET /runners": (_req, res) => {
      json(res, 200, { runners: listRunnerInfo() });
    },

    "DELETE /runners": (_req, res, url) => {
      const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
      if (!runner) {
        json(res, 404, { error: "no such runner" });
        return;
      }
      stopRunner(runner);
      json(res, 200, { stopped: runner.id });
    },

    "POST /restart": (_req, res, url) => {
      const runner = runnerFromReq(url);
      stopRunner(runner);
      setTimeoutImpl(() => {
        if (state.runners.has(runner.id)) startRunner(runner);
      }, 300);
      json(res, 202, { restarting: true, runner: runner.id });
    },

    "POST /open-session": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const requestedSession = body?.sessionKey || body?.sessionPath;
      const sessionRef = requestedSession ? sessionReferenceParam(body) : null;
      if (requestedSession && !sessionRef) {
        json(res, 400, { error: `not a session reference: ${requestedSession}` });
        return;
      }
      const persistedSession = sessionRef ? lookupSessionReference(sessionRef) : null;
      if (sessionRef && !persistedSession) {
        json(res, 404, { error: `session not found: ${sessionRef.id}` });
        return;
      }
      let dir = body?.dir ? resolveSafePath(resolvePath(String(body.dir))) : null;
      if (body?.dir && !dir) {
        json(res, 403, { error: `path outside the allowed roots: ${body.dir}` });
        return;
      }
      if (sessionRef?.backend === "sqlite" && persistedSession?.cwd) {
        dir = resolveSafePath(resolvePath(persistedSession.cwd));
        if (!dir) {
          json(res, 403, { error: `stored session path outside the allowed roots: ${persistedSession.cwd}` });
          return;
        }
      }
      if (dir) {
        let validDirectory = false;
        try { validDirectory = isDirectory(dir); } catch {}
        if (!validDirectory) {
          json(res, 400, { error: `not a directory: ${dir}` });
          return;
        }
        state.currentDir = dir;
      }
      const runner = openSessionRunner({ sessionRef, dir });
      json(res, 200, { runner: runnerInfo(runner) });
    },
  };
}
