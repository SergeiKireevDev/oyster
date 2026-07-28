#!/usr/bin/env node
/**
 * Manual Docker performance-data generator.
 *
 * This runs inside the Oyster container prepared by prepare-longcat-container.sh.
 * It creates independent runners, selects LongCat for every runner, sends the
 * requested number of prompts, verifies the persisted transcripts, and stops
 * every process before returning. It is deliberately outside tests/*.test.mjs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const config = Object.freeze({
  baseUrl: String(process.env.PERF_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
  token: String(process.env.OYSTER_TOKEN ?? "longcat-performance-preparation"),
  provider: String(process.env.PERF_MODEL_PROVIDER ?? "meituan"),
  model: String(process.env.PERF_MODEL_ID ?? "LongCat-2.0"),
  sessionCount: positiveInteger("PERF_SESSION_COUNT", 100),
  messageCount: positiveInteger("PERF_MESSAGE_COUNT", 100),
  setupConcurrency: positiveInteger("PERF_SETUP_CONCURRENCY", 10),
  promptConcurrency: positiveInteger("PERF_PROMPT_CONCURRENCY", 100),
  verifyConcurrency: positiveInteger("PERF_VERIFY_CONCURRENCY", 10),
  eventTimeoutMs: positiveInteger("PERF_EVENT_TIMEOUT_MS", 300_000),
  requestTimeoutMs: positiveInteger("PERF_REQUEST_TIMEOUT_MS", 60_000),
  reportPath: String(process.env.PERF_REPORT_PATH ?? "/var/lib/oyster-performance/longcat-100x100.json"),
  workdir: String(process.env.PERF_WORKDIR ?? "/workspace"),
});

let sequence = 0;
const opened = [];
const promptDurations = [];
const startedAt = new Date();
const startedMs = performance.now();
let completedPrompts = 0;
let cleanupResult = null;
let verification = null;
let runError = null;
let shuttingDown = false;

function marker(sessionNumber, messageNumber) {
  return `[oyster-longcat-perf session=${sessionNumber} message=${messageNumber}]`;
}

function promptText(sessionNumber, messageNumber) {
  return `${marker(sessionNumber, messageNumber)} Reply with exactly OK. Do not use tools.`;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : (part?.text ?? "")).join("\n");
}

async function api(method, path, body = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout: ${method} ${path}`)), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${data.error ?? response.statusText}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

class EventFeed {
  constructor(runnerId) {
    this.runnerId = runnerId;
    this.controller = new AbortController();
    this.waiters = new Set();
    this.closed = false;
    this.readPromise = null;
  }

  waitFor(predicate, label, timeoutMs = config.eventTimeoutMs) {
    let waiter;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`runner ${this.runnerId}: timed out waiting for ${label}`));
      }, timeoutMs);
      waiter = {
        predicate,
        resolve(value) { clearTimeout(timer); resolve(value); },
        reject(error) { clearTimeout(timer); reject(error); },
        cancel() { clearTimeout(timer); },
      };
      this.waiters.add(waiter);
    });
    return {
      promise,
      cancel: () => {
        if (!this.waiters.delete(waiter)) return;
        waiter.cancel();
      },
    };
  }

  dispatch(message) {
    for (const waiter of this.waiters) {
      let matched = false;
      try { matched = waiter.predicate(message); }
      catch (error) {
        this.waiters.delete(waiter);
        waiter.reject(error);
        continue;
      }
      if (!matched) continue;
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
    if (message?.type === "pi_error") this.fail(new Error(`runner ${this.runnerId}: ${message.error ?? "pi error"}`));
    if (message?.type === "pi_exit" && !this.closed && !shuttingDown) {
      this.fail(new Error(`runner ${this.runnerId}: pi exited unexpectedly (${message.signal ?? message.code ?? "unknown"})`));
    }
  }

  fail(error) {
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters.clear();
  }

  async start() {
    if (this.readPromise) return;
    const timer = setTimeout(() => this.controller.abort(new Error("event stream connection timeout")), config.requestTimeoutMs);
    let response;
    try {
      response = await fetch(`${config.baseUrl}/events?runner=${encodeURIComponent(this.runnerId)}&replay=1`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: this.controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || !response.body) throw new Error(`runner ${this.runnerId}: event stream failed (${response.status})`);
    this.readPromise = this.read(response.body).catch((error) => {
      if (!this.closed) this.fail(error);
    });
  }

  async read(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data = [];
    const consumeLine = (rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        if (data.length) {
          const payload = data.join("\n");
          data = [];
          try { this.dispatch(JSON.parse(payload)); } catch {}
        }
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    if (buffer) consumeLine(buffer);
    consumeLine("");
    if (!this.closed) throw new Error(`runner ${this.runnerId}: event stream ended`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.fail(new Error(`runner ${this.runnerId}: event stream closed`));
  }
}

async function rpc(runner, command, { waitForSettled = false } = {}) {
  const id = `perf-${++sequence}`;
  const responseWait = runner.feed.waitFor(
    (message) => message?.type === "response" && message.id === id,
    `${command.type} response`,
  );
  // The release-fallback Dockerfile pins pi 0.80.3, which predates
  // agent_settled. A non-retrying agent_end is its compatible completion
  // boundary; newer agents prefer the fully settled event.
  const settledWait = waitForSettled
    ? runner.feed.waitFor(
      (message) => message?.type === "agent_settled" || (message?.type === "agent_end" && message.willRetry !== true),
      `${command.type} completion`,
    )
    : null;
  // The stream can fail while the HTTP acknowledgement is still in flight.
  // Mark both waiter rejections handled immediately; awaiting them below still
  // observes and propagates the original error.
  void responseWait.promise.catch(() => {});
  if (settledWait) void settledWait.promise.catch(() => {});
  try {
    await api("POST", `/rpc?runner=${encodeURIComponent(runner.id)}`, { id, ...command });
    const response = await responseWait.promise;
    if (!response.success) throw new Error(`runner ${runner.id}: ${command.type} rejected: ${response.error ?? "unknown error"}`);
    if (settledWait) await settledWait.promise;
    return response.data;
  } catch (error) {
    responseWait.cancel();
    settledWait?.cancel();
    throw error;
  }
}

async function mapLimit(items, limit, operation) {
  let cursor = 0;
  let firstError = null;
  const cancelled = () => Boolean(firstError);
  async function worker() {
    for (;;) {
      if (firstError) return;
      const index = cursor++;
      if (index >= items.length) return;
      try { await operation(items[index], index, cancelled); }
      catch (error) { firstError ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (firstError) throw firstError;
}

async function openRunner(_unused, index) {
  const sessionNumber = index + 1;
  const openedResponse = await api("POST", "/open-session", { dir: config.workdir });
  const runner = { id: openedResponse.runner?.id, sessionNumber, feed: null };
  if (!runner.id) throw new Error(`session ${sessionNumber}: /open-session returned no runner id`);
  opened.push(runner);

  runner.feed = new EventFeed(runner.id);
  const stateWait = runner.feed.waitFor(
    (message) => message?.type === "response" && message.command === "get_state" && message.success && message.data?.sessionId,
    "initial session state",
  );
  void stateWait.promise.catch(() => {});
  try {
    await runner.feed.start();
    const state = await stateWait.promise;
    runner.sessionId = state.data.sessionId;
  } catch (error) {
    stateWait.cancel();
    throw error;
  }

  const selected = await rpc(runner, { type: "set_model", provider: config.provider, modelId: config.model });
  if (selected?.provider !== config.provider || selected?.id !== config.model) {
    throw new Error(`runner ${runner.id}: selected unexpected model ${selected?.provider ?? "?"}/${selected?.id ?? "?"}`);
  }
  await rpc(runner, { type: "set_thinking_level", level: "off" });
  await rpc(runner, { type: "set_session_name", name: `LongCat perf ${String(sessionNumber).padStart(3, "0")}` });

  if (opened.length % 10 === 0 || opened.length === config.sessionCount) {
    console.log(`::progress setup ${opened.length}/${config.sessionCount} sessions`);
  }
}

async function sendSessionPrompts(runner, _index, cancelled) {
  for (let messageNumber = 1; messageNumber <= config.messageCount; messageNumber++) {
    if (cancelled()) return;
    const before = performance.now();
    await rpc(runner, { type: "prompt", message: promptText(runner.sessionNumber, messageNumber) }, { waitForSettled: true });
    promptDurations.push(performance.now() - before);
    completedPrompts++;
    const total = config.sessionCount * config.messageCount;
    const interval = Math.max(1, Math.floor(total / 100));
    if (completedPrompts % interval === 0 || completedPrompts === total) {
      const elapsedSeconds = (performance.now() - startedMs) / 1000;
      console.log(`::progress messages ${completedPrompts}/${total} (${(completedPrompts / elapsedSeconds).toFixed(2)} prompts/s)`);
    }
  }
}

async function verifyTranscripts() {
  const runnerCatalog = await api("GET", "/runners");
  const byId = new Map((runnerCatalog.runners ?? []).map((runner) => [runner.id, runner]));
  const targets = opened.map((prepared) => ({ prepared, persisted: byId.get(prepared.id) }));
  if (targets.some(({ persisted }) => !persisted?.sessionKey)) throw new Error("one or more runners did not establish a persisted session key");
  if (new Set(targets.map(({ persisted }) => persisted.sessionKey)).size !== config.sessionCount) {
    throw new Error("prepared runners do not map to distinct persisted sessions");
  }

  const counts = new Array(targets.length);
  await mapLimit(targets, config.verifyConcurrency, async ({ prepared, persisted }, index) => {
    const transcript = await api("GET", `/session-messages?key=${encodeURIComponent(persisted.sessionKey)}`);
    const prefix = `[oyster-longcat-perf session=${prepared.sessionNumber} message=`;
    counts[index] = (transcript.messages ?? []).filter((message) =>
      message?.role === "user" && textContent(message.content).startsWith(prefix)).length;
    if (counts[index] !== config.messageCount) {
      throw new Error(`runner ${persisted.id}: expected ${config.messageCount} performance messages, found ${counts[index]}`);
    }
  });
  return {
    sessions: targets.length,
    distinctSessionKeys: new Set(targets.map(({ persisted }) => persisted.sessionKey)).size,
    minimumMessagesPerSession: Math.min(...counts),
    maximumMessagesPerSession: Math.max(...counts),
  };
}

async function deactivateRunners() {
  shuttingDown = true;
  const errors = [];
  await Promise.all(opened.map(async (runner) => {
    try { await api("DELETE", `/runners?id=${encodeURIComponent(runner.id)}`); }
    catch (error) { errors.push(error.message); }
  }));

  let alive = [];
  const deadline = Date.now() + 30_000;
  do {
    try {
      const catalog = await api("GET", "/runners");
      const targets = new Set(opened.map((runner) => runner.id));
      alive = (catalog.runners ?? []).filter((runner) => targets.has(runner.id) && runner.alive).map((runner) => runner.id);
    } catch (error) {
      errors.push(error.message);
      break;
    }
    if (!alive.length) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  for (const runner of opened) runner.feed?.close();
  if (alive.length) errors.push(`${alive.length} runner(s) remained alive after deactivation`);
  return { requested: opened.length, aliveAfterDeactivation: alive.length, errors };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function writeReport() {
  const endedAt = new Date();
  const elapsedSeconds = (performance.now() - startedMs) / 1000;
  const report = {
    status: runError || cleanupResult?.errors?.length ? "failed" : "complete",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedSeconds,
    configuration: {
      provider: config.provider,
      model: config.model,
      sessionCount: config.sessionCount,
      messageCount: config.messageCount,
      setupConcurrency: config.setupConcurrency,
      promptConcurrency: config.promptConcurrency,
      workdir: config.workdir,
    },
    results: {
      openedSessions: opened.length,
      completedPrompts,
      promptsPerSecond: elapsedSeconds ? completedPrompts / elapsedSeconds : null,
      promptLatencyMs: {
        minimum: promptDurations.length ? Math.min(...promptDurations) : null,
        p50: percentile(promptDurations, 0.50),
        p95: percentile(promptDurations, 0.95),
        p99: percentile(promptDurations, 0.99),
        maximum: promptDurations.length ? Math.max(...promptDurations) : null,
      },
      verification,
      cleanup: cleanupResult,
    },
    error: runError ? String(runError.stack ?? runError.message ?? runError) : null,
  };
  await mkdir(dirname(config.reportPath), { recursive: true });
  await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`::report ${config.reportPath}`);
}

async function main() {
  console.log(`Preparing ${config.sessionCount} sessions × ${config.messageCount} messages with ${config.provider}/${config.model}`);
  try {
    await mapLimit(Array.from({ length: config.sessionCount }), config.setupConcurrency, openRunner);
    await mapLimit(opened, config.promptConcurrency, sendSessionPrompts);
    verification = await verifyTranscripts();
  } catch (error) {
    runError = error;
  }

  cleanupResult = await deactivateRunners();
  await writeReport();
  if (runError) throw runError;
  if (cleanupResult.errors.length) throw new Error(`runner cleanup failed: ${cleanupResult.errors.join("; ")}`);
  console.log(`Prepared and deactivated ${opened.length} LongCat sessions with ${completedPrompts} prompts.`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    runError ??= new Error(`received ${signal}`);
    void deactivateRunners().finally(() => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
  });
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
