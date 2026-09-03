import { statSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeLastEventId, sseDataFrame } from "../../sse.mjs";

const MAX_PROMPT_BYTES = 5 * 1024 * 1024;
const MAX_PARENT_SESSION_ID_BYTES = 512;
const MAX_SUBAGENT_NAME_BYTES = 256;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function disableCaching(res) {
  res.setHeader?.("cache-control", "no-store");
}

function isJsonObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Build runner process, SSE, and RPC routes from stable-state operations. */
export function createRunnerRoutes({
  state,
  runnerFromReq,
  startRunner,
  listRunnerInfo,
  requestContext,
  sendToRunner,
  acknowledgeRunnerAttention,
  stopRunner,
  stopRunnerFamily = stopRunner,
  spawnRunner,
  observeRunner,
  runnerInfo,
  replayRunnerEvents = () => [],
  openSessionRunner,
  sessionReferenceParam,
  runnerHarnesses = () => [{ id: "pi", label: "pi" }],
  lookupSessionReference = () => ({}),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  subagentTimeoutMs = 30 * 60 * 1000,
  resolvePath = resolve,
  isDirectory = (path) => statSync(path).isDirectory(),
}) {
  if (!state || typeof state !== "object" || !(state.runners instanceof Map) || !(state.sseClients instanceof Set)) {
    throw new TypeError("state with runners Map and sseClients Set is required");
  }
  if (!requestContext || typeof requestContext.json !== "function"
    || typeof requestContext.readJsonBody !== "function" || typeof requestContext.resolveSafePath !== "function") {
    throw new TypeError("requestContext response, JSON body, and safe-path helpers are required");
  }
  const requiredFunctions = {
    runnerFromReq, startRunner, listRunnerInfo, sendToRunner, acknowledgeRunnerAttention, stopRunner, stopRunnerFamily,
    runnerInfo, openSessionRunner, sessionReferenceParam, runnerHarnesses, lookupSessionReference,
    setIntervalImpl, clearIntervalImpl, setTimeoutImpl,
    clearTimeoutImpl, resolvePath, isDirectory, replayRunnerEvents,
  };
  const missingFunction = Object.entries(requiredFunctions).find(([, value]) => typeof value !== "function");
  if (missingFunction) throw new TypeError(`${missingFunction[0]} must be a function`);
  if (!Number.isFinite(subagentTimeoutMs) || subagentTimeoutMs <= 0) {
    throw new RangeError("subagentTimeoutMs must be a positive finite number");
  }

  const { json, readJsonBody, resolveSafePath } = requestContext;

  return {
    "GET /events": async (req, res, url) => {
      const runner = await runnerFromReq(url);
      // Subscribing is a read-only operation. Keep a stopped runner dormant;
      // commands sent through /rpc can revive it when work is requested.
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "private, no-store, no-cache, must-revalidate, no-transform",
        "cdn-cache-control": "no-store",
        "surrogate-control": "no-store",
        pragma: "no-cache",
        expires: "0",
        vary: "Last-Event-ID",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.flushHeaders?.();
      res.write(`retry: 2000\n: connected ${" ".repeat(2048)}\n\n`);
      res.runnerId = runner.id;
      state.sseClients.add(res);

      let ping = null;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (ping !== null) clearIntervalImpl(ping);
        state.sseClients.delete(res);
      };
      req.once("close", cleanup);
      res.once?.("close", cleanup);

      if (url.searchParams.get("replay") !== "0") {
        const afterSseId = normalizeLastEventId(req.headers?.["last-event-id"]);
        for (const line of await replayRunnerEvents(runner, { afterSseId })) res.write(sseDataFrame(line));
      }
      res.write(sseDataFrame(JSON.stringify({
        type: "replay_done",
        _server: true,
        runner: runner.id,
        piRunning: !!runner.proc,
        workdir: runner.dir,
        runners: listRunnerInfo(),
      })));
      if (!closed) {
        ping = setIntervalImpl(() => {
          if (res.writableEnded || res.destroyed) {
            cleanup();
            return;
          }
          res.write(sseDataFrame(JSON.stringify({ type: "ping", _server: true })));
        }, 25000);
        ping?.unref?.();
      }
    },

    "POST /rpc": async (req, res, url) => {
      const command = await readJsonBody(req, res);
      if (command === undefined) return;
      if (!isJsonObject(command) || typeof command.type !== "string" || !command.type.trim()) {
        json(res, 400, { error: "command must be an object with a non-empty string `type`" });
        return;
      }
      const runner = await runnerFromReq(url);
      // State refreshes happen while opening a transcript and must not turn a
      // read-only visit into a live pi process. User commands still autostart.
      const readOnly = command.type === "get_state" || command.type === "get_messages";
      const queued = await sendToRunner(runner, command, { autostart: !readOnly });
      json(res, queued ? 202 : 503, queued
        ? { queued: true, runner: runner.id, ...(runner.resumeId ? { pendingResume: true } : {}) }
        : { error: "pi process unavailable" });
    },

    "GET /runners": (_req, res) => {
      disableCaching(res);
      json(res, 200, { runners: listRunnerInfo(), harnesses: runnerHarnesses() });
    },

    "POST /runner/attention/read": async (_req, res, url) => {
      const runner = await runnerFromReq(url);
      acknowledgeRunnerAttention(runner);
      json(res, 200, { runner: runner.id, attentionStatus: runner.attentionStatus ?? null, attentionUnread: false });
    },

    "DELETE /runners": async (_req, res, url) => {
      const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
      if (!runner) {
        json(res, 404, { error: "no such runner" });
        return;
      }
      await stopRunnerFamily(runner);
      json(res, 200, { stopped: runner.id });
    },

    "POST /restart": async (_req, res, url) => {
      const runner = await runnerFromReq(url);
      await stopRunner(runner);
      const restartTimer = setTimeoutImpl(async () => {
        if (state.runners.has(runner.id)) await startRunner(runner);
      }, 300);
      restartTimer?.unref?.();
      json(res, 202, { restarting: true, runner: runner.id });
    },

    "POST /subagents": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!isJsonObject(body)) {
        json(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const parentSessionId = typeof body.parentSessionId === "string" ? body.parentSessionId.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!prompt || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
        json(res, 400, { error: "prompt must be a non-empty string no larger than 5 MiB" });
        return;
      }
      if (!parentSessionId || Buffer.byteLength(parentSessionId) > MAX_PARENT_SESSION_ID_BYTES || parentSessionId.includes("\0")) {
        json(res, 400, { error: "parentSessionId must be a non-empty session identity no larger than 512 bytes" });
        return;
      }
      if (!name || Buffer.byteLength(name) > MAX_SUBAGENT_NAME_BYTES || name.includes("\0")) {
        json(res, 400, { error: "name must be a non-empty string no larger than 256 bytes" });
        return;
      }
      if (body.dir !== undefined && (typeof body.dir !== "string" || !body.dir.trim())) {
        json(res, 400, { error: "dir must be a non-empty string" });
        return;
      }
      const dir = body.dir === undefined ? state.currentDir : resolveSafePath(resolvePath(body.dir));
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

      const runner = await spawnRunner({
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

      let observerDispose = null;
      let disposeRequested = false;
      let timer = null;
      let heartbeat = null;
      let done = false;
      let resolveCompletion;
      let assistantOutput = "";
      let assistantError = "";
      const completion = new Promise((resolve) => { resolveCompletion = resolve; });
      const dispose = () => {
        if (!observerDispose) {
          disposeRequested = true;
          return;
        }
        try { observerDispose(); } catch {}
        observerDispose = null;
      };
      const finish = (result) => {
        if (done) return;
        done = true;
        dispose();
        if (timer !== null) clearTimeoutImpl(timer);
        if (heartbeat !== null) clearIntervalImpl(heartbeat);
        resolveCompletion(result);
      };
      const fail = (fallback, error) => finish({
        ok: false,
        output: assistantOutput,
        errorLog: error === undefined || error === null || error === "" ? fallback : errorMessage(error),
      });

      try {
        observerDispose = observeRunner(runner, (event) => {
          if (!isJsonObject(event)) return;
          if (event.type === "message_end" && event.message?.role === "assistant") {
            const content = Array.isArray(event.message.content) ? event.message.content : [];
            const text = content
              .filter((part) => isJsonObject(part) && part.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n");
            if (text) assistantOutput = text;
            if (["error", "aborted"].includes(event.message.stopReason)) {
              assistantError = typeof event.message.errorMessage === "string" && event.message.errorMessage
                ? event.message.errorMessage
                : `assistant stopped: ${event.message.stopReason}`;
            }
          } else if (event.type === "agent_settled") {
            finish({ ok: !assistantError, output: assistantOutput, errorLog: assistantError });
          } else if (event.type === "response" && event.command === "prompt" && event.success === false) {
            fail("Subagent prompt was rejected.", event.error);
          } else if (event.type === "pi_error") {
            fail("Subagent process failed.", event.error);
          } else if (event.type === "pi_exit") {
            fail(`Subagent exited before settling${event.signal ? ` (${event.signal})` : ""}.`);
          }
        });
        if (typeof observerDispose !== "function") throw new TypeError("observeRunner must return a disposal function");
        if (disposeRequested) dispose();
      } catch (error) {
        fail("Unable to observe subagent process.", error);
      }

      if (!done) {
        heartbeat = setIntervalImpl(() => {
          if (!res.writableEnded && !res.destroyed) writeEvent({ type: "heartbeat", timestamp: Date.now() });
        }, 25_000);
        heartbeat?.unref?.();
        timer = setTimeoutImpl(() => fail("Subagent timed out."), subagentTimeoutMs);
        timer?.unref?.();
      }

      let disconnected = false;
      const cancel = () => {
        disconnected = true;
        fail("Subagent request was cancelled.");
      };
      res.on?.("close", cancel);
      runner.subagentStatus = "running";
      if (!done) {
        try {
          if (!await sendToRunner(runner, { type: "prompt", message: prompt })) fail("Subagent process was unavailable.");
        } catch (error) {
          fail("Subagent process was unavailable.", error);
        }
      }
      let result = await completion;
      res.off?.("close", cancel);
      runner.subagentStatus = result.ok ? "succeeded" : "failed";
      try {
        await stopRunner(runner);
      } catch (error) {
        result = { ok: false, output: result.output, errorLog: `Failed to stop subagent: ${errorMessage(error)}` };
        runner.subagentStatus = "failed";
      }
      if (!disconnected && !res.writableEnded && !res.destroyed) {
        writeEvent({ type: "complete", ...result, runner: runnerInfo(runner) });
        res.end();
      }
    },

    "POST /open-session": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!isJsonObject(body)) {
        json(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      for (const key of ["sessionKey", "sessionPath", "dir", "harness"]) {
        if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim())) {
          json(res, 400, { error: `${key} must be a non-empty string` });
          return;
        }
      }
      if (body.sessionKey !== undefined && body.sessionPath !== undefined) {
        json(res, 400, { error: "provide either sessionKey or sessionPath, not both" });
        return;
      }
      const requestedSession = body.sessionKey ?? body.sessionPath;
      const harnesses = runnerHarnesses();
      const harness = body.harness ?? null;
      if (harness && !harnesses.some((candidate) => candidate.id === harness)) {
        json(res, 400, { error: `unknown or unavailable harness: ${harness}` });
        return;
      }
      if (requestedSession && harness) {
        json(res, 400, { error: "harness can only be selected for a new session" });
        return;
      }
      const sessionRef = requestedSession !== undefined ? sessionReferenceParam(body) : null;
      if (requestedSession && !sessionRef) {
        json(res, 400, { error: `not a session reference: ${requestedSession}` });
        return;
      }
      const persistedSession = sessionRef ? await lookupSessionReference(sessionRef) : null;
      if (sessionRef && sessionRef.backend !== "claude-code" && !persistedSession) {
        json(res, 404, { error: `session not found: ${sessionRef.id}` });
        return;
      }
      let dir = body.dir !== undefined ? resolveSafePath(resolvePath(body.dir)) : null;
      if (body.dir !== undefined && !dir) {
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
      const runner = await openSessionRunner({ harness, sessionRef, dir });
      json(res, 200, { runner: runnerInfo(runner) });
    },
  };
}
