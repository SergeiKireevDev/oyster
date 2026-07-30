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
  stopRunnerFamily = stopRunner,
  spawnRunner,
  observeRunner,
  runnerInfo,
  replayRunnerEvents = () => [],
  openSessionRunner,
  sessionReferenceParam,
  lookupSessionReference = () => ({}),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  subagentTimeoutMs = 30 * 60 * 1000,
  resolvePath = resolve,
  isDirectory = (path) => statSync(path).isDirectory(),
}) {
  const json = requestContext?.json;
  const readJsonBody = requestContext?.readJsonBody;
  const resolveSafePath = requestContext?.resolveSafePath;

  return {
    "GET /events": (req, res, url) => {
      const runner = runnerFromReq(url);
      // Subscribing is a read-only operation. Keep a stopped runner dormant;
      // commands sent through /rpc can revive it when work is requested.
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
        () => res.write(`data: ${JSON.stringify({ type: "ping", _server: true })}\n\n`),
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
      // State refreshes happen while opening a transcript and must not turn a
      // read-only visit into a live pi process. User commands still autostart.
      const readOnly = command.type === "get_state" || command.type === "get_messages";
      const queued = sendToRunner(runner, command, { autostart: !readOnly });
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
      stopRunnerFamily(runner);
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

    "POST /subagents": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const prompt = typeof body?.prompt === "string" ? body.prompt : "";
      const parentSessionId = typeof body?.parentSessionId === "string" ? body.parentSessionId.trim() : "";
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!prompt || prompt.length > 5 * 1024 * 1024) {
        json(res, 400, { error: "prompt must be a non-empty string no larger than 5 MiB" });
        return;
      }
      if (!parentSessionId || parentSessionId.length > 512) {
        json(res, 400, { error: "parentSessionId must be a non-empty session identity" });
        return;
      }
      if (!name || name.length > 256) {
        json(res, 400, { error: "name must be a non-empty string no longer than 256 characters" });
        return;
      }
      const dir = body?.dir ? resolveSafePath(resolvePath(String(body.dir))) : state.currentDir;
      if (!dir) {
        json(res, 403, { error: `path outside the allowed roots: ${body?.dir}` });
        return;
      }
      let validDirectory = false;
      try { validDirectory = isDirectory(dir); } catch {}
      if (!validDirectory) {
        json(res, 400, { error: `not a directory: ${dir}` });
        return;
      }
      if (typeof spawnRunner !== "function" || typeof observeRunner !== "function") {
        json(res, 503, { error: "managed subagents are unavailable" });
        return;
      }

      const runner = spawnRunner({
        dir,
        autostart: false,
        initialArgs: ["--parent-session", parentSessionId, "--name", name, "--exclude-tools", "loop"],
      });
      const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`);
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      });
      res.flushHeaders?.();
      writeEvent({ type: "started", runner: runnerInfo(runner) });

      let dispose = () => {};
      let timer = null;
      let heartbeat = null;
      let finish;
      let assistantOutput = "";
      let assistantError = "";
      const completion = new Promise((resolveCompletion) => {
        let done = false;
        finish = (result) => {
          if (done) return;
          done = true;
          dispose();
          if (timer) clearTimeoutImpl(timer);
          if (heartbeat) clearIntervalImpl(heartbeat);
          resolveCompletion(result);
        };
        dispose = observeRunner(runner, (event) => {
          if (event.type === "message_end" && event.message?.role === "assistant") {
            const text = event.message.content
              ?.filter((part) => part.type === "text")
              .map((part) => part.text || "")
              .join("\n");
            if (text) assistantOutput = text;
            if (["error", "aborted"].includes(event.message.stopReason)) {
              assistantError = event.message.errorMessage || `assistant stopped: ${event.message.stopReason}`;
            }
          } else if (event.type === "agent_settled") {
            finish({ ok: !assistantError, output: assistantOutput, errorLog: assistantError });
          } else if (event.type === "response" && event.command === "prompt" && event.success === false) {
            finish({ ok: false, output: assistantOutput, errorLog: event.error || "Subagent prompt was rejected." });
          } else if (event.type === "pi_error") {
            finish({ ok: false, output: assistantOutput, errorLog: event.error || "Subagent process failed." });
          } else if (event.type === "pi_exit") {
            finish({ ok: false, output: assistantOutput, errorLog: `Subagent exited before settling${event.signal ? ` (${event.signal})` : ""}.` });
          }
        });
        heartbeat = setIntervalImpl(() => {
          if (!res.writableEnded && !res.destroyed) writeEvent({ type: "heartbeat", timestamp: Date.now() });
        }, 25_000);
        heartbeat?.unref?.();
        timer = setTimeoutImpl(() => {
          finish({ ok: false, output: assistantOutput, errorLog: "Subagent timed out." });
        }, subagentTimeoutMs);
        timer?.unref?.();
      });

      let disconnected = false;
      const cancel = () => {
        disconnected = true;
        if (!res.writableEnded) finish({ ok: false, output: assistantOutput, errorLog: "Subagent request was cancelled." });
      };
      res.on?.("close", cancel);
      runner.subagentStatus = "running";
      if (!sendToRunner(runner, { type: "prompt", message: prompt })) {
        finish({ ok: false, output: "", errorLog: "Subagent process was unavailable." });
      }
      const result = await completion;
      res.off?.("close", cancel);
      runner.subagentStatus = result.ok ? "succeeded" : "failed";
      stopRunner(runner);
      if (!disconnected && !res.writableEnded && !res.destroyed) {
        writeEvent({ type: "complete", ...result, runner: runnerInfo(runner) });
        res.end();
      }
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
