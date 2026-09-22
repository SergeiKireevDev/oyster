import { runnerHasSessionIdentity } from "../../session-references.mjs";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeLastEventId, sseDataFrame } from "../../sse.mjs";
const MILLISECONDS_PER_SECOND = 1000;
const BYTES_PER_KIBIBYTE = 1024;
const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const SSE_INITIAL_PADDING_LENGTH = 2048;
const STOP_ATTENTION_TIMEOUT_MS = 25_000;
const RESTART_DELAY_MS = 25000;
const SUBAGENT_TIMEOUT_MINUTES = 30;
const RUNNER_RESTART_DELAY_MS = 300;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const MAX_PROMPT_MIBIBYTES = 5;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
const SECONDS_PER_MINUTE = 60;
const NO_SUCH_RUNNER_ERROR = "no such runner";


const MAX_PROMPT_BYTES = MAX_PROMPT_MIBIBYTES * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const MAX_PARENT_SESSION_ID_BYTES = 512;
const MAX_SUBAGENT_NAME_BYTES = 256;
const MAX_UI_REQUEST_TEXT_BYTES = 4096;

import { errorMessage } from "../../errors.mjs";
import { disableCaching } from "../createRequestContext.mjs";
import { isNonArrayObject as isJsonObject } from "../../valuePredicates.mjs";

function textField(body, name) {
  return typeof body[name] === "string" ? body[name].trim() : "";
}

function boundedText(value, maxBytes, { rejectNul = false } = {}) {
  return Boolean(value) && Buffer.byteLength(value) <= maxBytes && (!rejectNul || !value.includes("\0"));
}

function resolveSubagentDir(body, { state, resolveSafePath, resolvePath, isDirectory }) {
  if (body.dir !== undefined && (typeof body.dir !== "string" || !body.dir.trim())) return { status: 400, error: "dir must be a non-empty string" };
  const dir = body.dir === undefined ? state.currentDir : resolveSafePath(resolvePath(body.dir));
  if (!dir) return { status: 403, error: `path outside the allowed roots: ${body?.dir}` };
  let validDirectory = false;
  try { validDirectory = isDirectory(dir); } catch {}
  return validDirectory ? { dir } : { status: 400, error: `not a directory: ${dir}` };
}

function parseSubagentRequest(body, options) {
  if (!isJsonObject(body)) return { status: 400, error: "request body must be a JSON object" };
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const parentSessionId = textField(body, "parentSessionId");
  const name = textField(body, "name");
  if (!boundedText(prompt, MAX_PROMPT_BYTES)) return { status: 400, error: "prompt must be a non-empty string no larger than 5 MiB" };
  if (!boundedText(parentSessionId, MAX_PARENT_SESSION_ID_BYTES, { rejectNul: true })) return { status: 400, error: "parentSessionId must be a non-empty session identity no larger than 512 bytes" };
  if (!boundedText(name, MAX_SUBAGENT_NAME_BYTES, { rejectNul: true })) return { status: 400, error: "name must be a non-empty string no larger than 256 bytes" };
  const directory = resolveSubagentDir(body, options);
  return directory.error ? directory : { prompt, parentSessionId, name, dir: directory.dir };
}

async function startSubagentRunner({ spawnRunner, dir, parentSessionId, name }) {
  return spawnRunner({
    dir,
    autostart: false,
    initialArgs: ["--parent-session", parentSessionId, "--name", name, "--exclude-tools", "loop"],
  });
}

function formatSubagentFailure(fallback, error, output) {
  return {
    ok: false,
    output,
    errorLog: error === undefined || error === null || error === "" ? fallback : errorMessage(error),
  };
}

async function streamSubagentLifecycle({
  runner, prompt, res, observeRunner, sendToRunner, stopRunner, runnerInfo,
  setIntervalImpl, clearIntervalImpl, setTimeoutImpl, clearTimeoutImpl, subagentTimeoutMs,
}) {
  const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`);
  res.writeHead(HTTP_OK, {
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
  const completion = new Promise((resolvePromise) => { resolveCompletion = resolvePromise; });
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
  const fail = (fallback, error) => finish(formatSubagentFailure(fallback, error, assistantOutput));

  const assistantText = (message) => (Array.isArray(message.content) ? message.content : [])
    .filter((part) => isJsonObject(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const rememberAssistantMessage = (message) => {
    const text = assistantText(message);
    if (text) assistantOutput = text;
    if (["error", "aborted"].includes(message.stopReason)) {
      assistantError = typeof message.errorMessage === "string" && message.errorMessage
        ? message.errorMessage
        : `assistant stopped: ${message.stopReason}`;
    }
  };
  const observeEvent = (event) => {
    if (!isJsonObject(event)) return;
    if (event.type === "message_end" && event.message?.role === "assistant") rememberAssistantMessage(event.message);
    else if (event.type === "agent_settled") finish({ ok: !assistantError, output: assistantOutput, errorLog: assistantError });
    else if (event.type === "response" && event.command === "prompt" && event.success === false) fail("Subagent prompt was rejected.", event.error);
    else if (event.type === "pi_error") fail("Subagent process failed.", event.error);
    else if (event.type === "pi_exit") {
      const signalSuffix = event.signal ? ` (${event.signal})` : "";
      fail(`Subagent exited before settling${signalSuffix}.`);
    }
  };

  try {
    observerDispose = observeRunner(runner, observeEvent);
    if (typeof observerDispose !== "function") throw new TypeError("observeRunner must return a disposal function");
    if (disposeRequested) dispose();
  } catch (error) {
    fail("Unable to observe subagent process.", error);
  }

  if (!done) {
    heartbeat = setIntervalImpl(() => {
      if (!res.writableEnded && !res.destroyed) writeEvent({ type: "heartbeat", timestamp: Date.now() });
    }, STOP_ATTENTION_TIMEOUT_MS);
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
}

/** Build runner process, SSE, and RPC routes from stable-state operations. */
export function createRunnerRoutes({
  state,
  runnerFromReq,
  startRunner,
  listRunnerInfo,
  requestContext,
  sendToRunner,
  requestRunnerUi = async () => { throw new Error("runner UI requests are unavailable"); },
  acknowledgeRunnerAttention,
  stopRunner,
  stopRunnerFamily = stopRunner,
  runnersChanged = () => {},
  spawnRunner,
  observeRunner,
  runnerInfo,
  replayRunnerEvents = () => [],
  openSessionRunner,
  sessionReferenceParam,
  runnerHarnesses = () => [{ id: "pi", label: "pi" }],
  lookupSessionReference = () => ({}),
  syncClaudeTranscript = async () => { throw new Error("Claude transcript sink is unavailable"); },
  updateRunnerSessionReference = async () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  subagentTimeoutMs = SUBAGENT_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND,
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
    runnerFromReq, startRunner, listRunnerInfo, sendToRunner, requestRunnerUi, acknowledgeRunnerAttention, stopRunner, stopRunnerFamily,
    runnerInfo, openSessionRunner, sessionReferenceParam, runnerHarnesses, lookupSessionReference,
    syncClaudeTranscript, updateRunnerSessionReference,
    setIntervalImpl, clearIntervalImpl, setTimeoutImpl,
    clearTimeoutImpl, resolvePath, isDirectory, replayRunnerEvents,
  };
  const missingFunction = Object.entries(requiredFunctions).find(([, value]) => typeof value !== "function");
  if (missingFunction) throw new TypeError(`${missingFunction[0]} must be a function`);
  if (!Number.isFinite(subagentTimeoutMs) || subagentTimeoutMs <= 0) {
    throw new RangeError("subagentTimeoutMs must be a positive finite number");
  }

  const { json, readJsonBody, resolveSafePath } = requestContext;

  function validateOpenSessionBody(body) {
    if (!isJsonObject(body)) return "request body must be a JSON object";
    for (const key of ["sessionKey", "sessionPath", "dir", "harness"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim())) return `${key} must be a non-empty string`;
    }
    return body.sessionKey !== undefined && body.sessionPath !== undefined ? "provide either sessionKey or sessionPath, not both" : null;
  }

  function validateOpenSessionHarness({ harness, requestedSession }) {
    if (harness && !runnerHarnesses().some((candidate) => candidate.id === harness)) return `unknown or unavailable harness: ${harness}`;
    return requestedSession && harness ? "harness can only be selected for a new session" : null;
  }

  async function openSessionReference(body, requestedSession) {
    const sessionRef = requestedSession !== undefined ? sessionReferenceParam(body) : null;
    if (requestedSession && !sessionRef) return { error: `not a session reference: ${requestedSession}`, status: 400 };
    const persistedSession = sessionRef ? await lookupSessionReference(sessionRef) : null;
    if (sessionRef && sessionRef.storagePath !== null && !persistedSession) return { error: `session not found: ${sessionRef.id}`, status: 404 };
    return { sessionRef, persistedSession };
  }

  function resolveOpenSessionDir(body, sessionRef, persistedSession) {
    let dir = body.dir !== undefined ? resolveSafePath(resolvePath(body.dir)) : null;
    if (body.dir !== undefined && !dir) return { error: `path outside the allowed roots: ${body.dir}`, status: 403 };
    if (sessionRef?.backend === "sqlite" && persistedSession?.cwd) {
      dir = resolveSafePath(resolvePath(persistedSession.cwd));
      if (!dir) return { error: `stored session path outside the allowed roots: ${persistedSession.cwd}`, status: 403 };
    }
    if (!dir) return { dir: null };
    let validDirectory = false;
    try { validDirectory = isDirectory(dir); } catch {}
    return validDirectory ? { dir } : { error: `not a directory: ${dir}`, status: 400 };
  }

  function validateUiRequestBody(body) {
    if (!isJsonObject(body) || (body.method !== "input" && body.method !== "confirm")) return "method must be 'input' or 'confirm'";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || Buffer.byteLength(title) > MAX_UI_REQUEST_TEXT_BYTES) return "title must be a non-empty string no larger than 4 KiB";
    for (const field of ["placeholder", "message"]) {
      if (body[field] !== undefined && (typeof body[field] !== "string" || Buffer.byteLength(body[field]) > MAX_UI_REQUEST_TEXT_BYTES)) {
        return `${field} must be a string no larger than 4 KiB`;
      }
    }
    return null;
  }

  function uiRequestPayload(body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    return body.method === "input"
      ? { method: "input", title, ...(body.placeholder ? { placeholder: body.placeholder } : {}), secret: body.secret === true }
      : { method: "confirm", title, message: body.message ?? "" };
  }

  return {
    "GET /events": async (req, res, url) => {
      const runner = await runnerFromReq(url);
      // Subscribing is a read-only operation. Keep a stopped runner dormant;
      // commands sent through /rpc can revive it when work is requested.
      res.writeHead(HTTP_OK, {
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
      res.write(`retry: 2000\n: connected ${" ".repeat(SSE_INITIAL_PADDING_LENGTH)}\n\n`);
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
        }, RESTART_DELAY_MS);
        ping?.unref?.();
      }
    },

    "POST /rpc": async (req, res, url) => {
      const command = await readJsonBody(req, res);
      if (command === undefined) return;
      if (!isJsonObject(command) || typeof command.type !== "string" || !command.type.trim()) {
        json(res, HTTP_BAD_REQUEST, { error: "command must be an object with a non-empty string `type`" });
        return;
      }
      const runner = await runnerFromReq(url);
      // State refreshes happen while opening a transcript and must not turn a
      // read-only visit into a live agent process. User commands still autostart.
      const readOnly = command.type === "get_state" || command.type === "get_messages";
      const queued = await sendToRunner(runner, command, { autostart: !readOnly });
      json(res, queued ? HTTP_ACCEPTED : HTTP_SERVICE_UNAVAILABLE, queued
        ? { queued: true, runner: runner.id, ...(runner.resumeId ? { pendingResume: true } : {}) }
        : { error: "Agent process unavailable" });
    },

    "POST /runner/transcript/sync": async (_req, res, url) => {
      const runner = await runnerFromReq(url);
      if (runner.harness !== "claude-code") {
        json(res, HTTP_CONFLICT, { error: "transcript polling is only available for Claude Code runners" });
        return;
      }
      if (!runner.sessionId) {
        json(res, HTTP_CONFLICT, { error: "Claude Code session identity is not available yet" });
        return;
      }
      try {
        const result = await syncClaudeTranscript({ sessionId: runner.sessionId, cwd: runner.dir });
        if (result.reference) await updateRunnerSessionReference(runner, result.reference);
        disableCaching(res);
        json(res, HTTP_OK, result);
      } catch (error) {
        console.error(`[oyster] cannot sync Claude transcript ${runner.sessionId}: ${errorMessage(error)}`);
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: errorMessage(error) });
      }
    },

    "GET /runners": (_req, res) => {
      disableCaching(res);
      json(res, HTTP_OK, { runners: listRunnerInfo(), harnesses: runnerHarnesses() });
    },

    "POST /runner/attention/read": async (_req, res, url) => {
      const runner = await runnerFromReq(url);
      acknowledgeRunnerAttention(runner);
      json(res, HTTP_OK, { runner: runner.id, attentionStatus: runner.attentionStatus ?? null, attentionUnread: false });
    },

    // Long-polls until the runner's browser answers, cancels, or the request
    // times out. Meant for harness-side tools (the Oyster MCP server) that have
    // no extension UI of their own, such as the masked sudo password prompt.
    "POST /runner/ui-request": async (req, res, url) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const bodyError = validateUiRequestBody(body);
      if (bodyError) { json(res, HTTP_BAD_REQUEST, { error: bodyError }); return; }
      const runner = state.runners.get(String(url.searchParams.get("runner") ?? ""));
      if (!runner) { json(res, HTTP_NOT_FOUND, { error: NO_SUCH_RUNNER_ERROR }); return; }
      const controller = new AbortController();
      res.once?.("close", () => controller.abort());
      disableCaching(res);
      json(res, HTTP_OK, await requestRunnerUi(runner, uiRequestPayload(body), { signal: controller.signal }));
    },

    "DELETE /runners": async (_req, res, url) => {
      const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
      if (!runner) {
        json(res, HTTP_NOT_FOUND, { error: NO_SUCH_RUNNER_ERROR });
        return;
      }
      await stopRunnerFamily(runner);
      json(res, HTTP_OK, { stopped: runner.id });
    },

    "DELETE /runner/empty": async (_req, res, url) => {
      const runner = state.runners.get(String(url.searchParams.get("id") ?? ""));
      if (!runner) {
        json(res, HTTP_NOT_FOUND, { error: NO_SUCH_RUNNER_ERROR });
        return;
      }
      // Older runners can retain an identity after their agent session disappeared.
      // Only the matching catalog can establish that the saved session is absent.
      let missingSession = false;
      if (!runner.proc && !runner.busy && runner.sessionRef?.backend === state.sessionCatalog?.backend && state.sessionCatalog?.findById) {
        missingSession = (await state.sessionCatalog.findById(runner.sessionRef.id)) == null;
      }
      if (runner.proc || runner.busy || (runnerHasSessionIdentity(runner) && !missingSession)) {
        json(res, HTTP_CONFLICT, { error: "only stopped runners without a saved session can be deleted" });
        return;
      }
      await state.appStore?.repositories?.runners?.delete(runner.id);
      state.runners.delete(runner.id);
      if (state.defaultRunnerId === runner.id) {
        state.defaultRunnerId = null;
        await state.appSettings?.setDefaultRunnerId(null);
      }
      runnersChanged();
      json(res, HTTP_OK, { deleted: runner.id, runners: listRunnerInfo() });
    },

    "POST /restart": async (_req, res, url) => {
      const runner = await runnerFromReq(url);
      await stopRunner(runner);
      const restartTimer = setTimeoutImpl(async () => {
        if (state.runners.has(runner.id)) await startRunner(runner);
      }, RUNNER_RESTART_DELAY_MS);
      restartTimer?.unref?.();
      json(res, HTTP_ACCEPTED, { restarting: true, runner: runner.id });
    },

    "POST /subagents": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const parsed = parseSubagentRequest(body, { state, resolveSafePath, resolvePath, isDirectory });
      if (parsed.error) {
        json(res, parsed.status, { error: parsed.error });
        return;
      }
      if (typeof spawnRunner !== "function" || typeof observeRunner !== "function") {
        json(res, HTTP_SERVICE_UNAVAILABLE, { error: "managed subagents are unavailable" });
        return;
      }

      const runner = await startSubagentRunner({ spawnRunner, ...parsed });
      await streamSubagentLifecycle({
        runner,
        prompt: parsed.prompt,
        res,
        observeRunner,
        sendToRunner,
        stopRunner,
        runnerInfo,
        setIntervalImpl,
        clearIntervalImpl,
        setTimeoutImpl,
        clearTimeoutImpl,
        subagentTimeoutMs,
      });
    },

    "POST /open-session": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const bodyError = validateOpenSessionBody(body);
      if (bodyError) return json(res, HTTP_BAD_REQUEST, { error: bodyError });
      const requestedSession = body.sessionKey ?? body.sessionPath;
      const harness = body.harness ?? null;
      const harnessError = validateOpenSessionHarness({ harness, requestedSession });
      if (harnessError) return json(res, HTTP_BAD_REQUEST, { error: harnessError });
      const reference = await openSessionReference(body, requestedSession);
      if (reference.error) return json(res, reference.status, { error: reference.error });
      const directory = resolveOpenSessionDir(body, reference.sessionRef, reference.persistedSession);
      if (directory.error) return json(res, directory.status, { error: directory.error });
      if (directory.dir) state.currentDir = directory.dir;
      const runner = await openSessionRunner({ harness, sessionRef: reference.sessionRef, dir: directory.dir });
      json(res, HTTP_OK, { runner: runnerInfo(runner) });
    },
  };
}
