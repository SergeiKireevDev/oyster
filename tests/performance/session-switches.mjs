#!/usr/bin/env node
/**
 * Manual browser performance test for the exported LongCat fixture.
 *
 * Builds the current source, mounts the prepared .pi directory read-only into
 * a disposable container, switches through the first 20 named sessions in the
 * real UI, and requires the latest message for each selected session to render
 * within the configured budget.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const requireFromE2E = createRequire(join(ROOT, "tests/e2e/package.json"));
const { chromium } = requireFromE2E("@playwright/test");

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const config = Object.freeze({
  image: String(process.env.PERF_SWITCH_IMAGE ?? "oyster:session-switch-current"),
  dataDir: resolve(process.env.PERF_SWITCH_DATA_DIR ?? join(ROOT, "tests/data/longcat-100x100/.pi")),
  skipBuild: process.env.PERF_SWITCH_SKIP_BUILD === "1",
  revive: process.env.PERF_SWITCH_REVIVE === "1",
  token: String(process.env.OYSTER_TOKEN ?? "session-switch-performance"),
  sessionCount: positiveInteger("PERF_SWITCH_SESSION_COUNT", 20),
  reviveCount: positiveInteger("PERF_SWITCH_REVIVE_COUNT", 100),
  reviveConcurrency: positiveInteger("PERF_SWITCH_REVIVE_CONCURRENCY", 10),
  reviveTimeoutMs: positiveInteger("PERF_SWITCH_REVIVE_TIMEOUT_MS", 120_000),
  switchBudgetMs: positiveInteger("PERF_SWITCH_BUDGET_MS", 3_000),
  startupTimeoutMs: positiveInteger("PERF_SWITCH_STARTUP_TIMEOUT_MS", 60_000),
  reportPath: resolve(process.env.PERF_SWITCH_REPORT ?? (process.env.PERF_SWITCH_REVIVE === "1"
    ? "/tmp/oyster-session-switch-live-performance.json"
    : "/tmp/oyster-session-switch-performance.json")),
  headed: process.env.PERF_SWITCH_HEADED === "1",
});

const containerName = `oyster-session-switch-${process.pid}`;
let browser = null;
let containerStarted = false;
let report = null;
let revivalFeeds = [];
let rpcSequence = 0;

function docker(args, options = {}) {
  const output = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function configureBrowserRuntime() {
  const syslibs = join(homedir(), ".pw-syslibs");
  if (existsSync(syslibs)) {
    const libraries = [
      join(syslibs, "usr/lib/x86_64-linux-gnu"),
      join(syslibs, "usr/lib/x86_64-linux-gnu/gbm"),
    ].filter(existsSync);
    process.env.LD_LIBRARY_PATH = [...libraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
    const fontConfig = join(syslibs, "fonts.conf");
    if (existsSync(fontConfig)) {
      process.env.FONTCONFIG_FILE = fontConfig;
      process.env.FONTCONFIG_PATH = syslibs;
    }
  }

  const browserRoot = join(homedir(), ".cache/ms-playwright");
  if (!existsSync(browserRoot)) return {};
  for (const directory of readdirSync(browserRoot).sort().reverse()) {
    if (!directory.startsWith("chromium_headless_shell-")) continue;
    const executablePath = join(browserRoot, directory, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(executablePath)) return { executablePath };
  }
  return {};
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + config.startupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`container did not become healthy: ${lastError?.message ?? "timeout"}`);
}

async function api(baseUrl, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${data.error ?? response.statusText}`);
  return data;
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : (part?.text ?? "")).join("\n");
}

function sessionNumber(name) {
  const match = /^LongCat perf (\d{3})$/.exec(String(name ?? ""));
  return match ? Number(match[1]) : null;
}

function latestMessageExpectation(message, marker) {
  if (message?.role === "user") return { role: "user", text: marker };
  if (message?.role !== "assistant") throw new Error(`unsupported latest message role: ${message?.role ?? "missing"}`);
  if (message.errorMessage) {
    const rateLimit = String(message.errorMessage).match(/Rate limit exceeded|Request rate limit exceeded/i)?.[0];
    return { role: "assistant", text: rateLimit ?? String(message.errorMessage).slice(0, 120) };
  }
  const blocks = Array.isArray(message.content) ? message.content : [];
  const visible = [...blocks].reverse().find((block) => block?.type === "text" && block.text?.trim());
  const text = visible?.text?.trim() ?? messageText(message.content).trim();
  if (!text) throw new Error("latest assistant message has no assertable text");
  return { role: "assistant", text };
}

async function preparedSessions(baseUrl, { revived = config.revive } = {}) {
  const catalog = await api(baseUrl, "/runners");
  const sessions = (catalog.runners ?? [])
    .map((runner) => ({ ...runner, number: sessionNumber(runner.sessionName) }))
    .filter((runner) => runner.number != null)
    .sort((left, right) => left.number - right.number)
    .slice(0, config.sessionCount);
  if (sessions.length !== config.sessionCount) {
    throw new Error(`expected ${config.sessionCount} prepared LongCat sessions, found ${sessions.length}`);
  }

  for (const session of sessions) {
    if (!session.sessionKey) throw new Error(`${session.sessionName} has no persisted session key`);
    const transcript = await api(baseUrl, `/session-messages?key=${encodeURIComponent(session.sessionKey)}`);
    const messages = transcript.messages ?? [];
    const users = messages.filter((message) => message?.role === "user");
    const historicalMarker = `[oyster-longcat-perf session=${session.number} message=100]`;
    if (!users.some((message) => messageText(message.content).includes(historicalMarker))) {
      throw new Error(`${session.sessionName} is missing expected user marker ${historicalMarker}`);
    }
    const marker = revived
      ? `[oyster-session-switch-revive session=${String(session.number).padStart(3, "0")}]`
      : historicalMarker;
    if (!messageText(users.at(-1)?.content).includes(marker)) {
      throw new Error(`${session.sessionName} does not end with expected user marker ${marker}`);
    }
    session.marker = marker;
    session.latestMessage = latestMessageExpectation(messages.at(-1), marker);
  }
  return { allRunners: catalog.runners ?? [], sessions };
}

class EventFeed {
  constructor(baseUrl, runnerId) {
    this.baseUrl = baseUrl;
    this.runnerId = runnerId;
    this.controller = new AbortController();
    this.waiters = new Set();
    this.closed = false;
    this.replayComplete = false;
  }

  waitFor(predicate, label, timeoutMs = config.reviveTimeoutMs) {
    let waiter;
    const promise = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`runner ${this.runnerId}: timed out waiting for ${label}`));
      }, timeoutMs);
      waiter = {
        predicate,
        resolve(value) { clearTimeout(timer); resolvePromise(value); },
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
    if (message?.type === "replay_done") this.replayComplete = true;
    if (this.replayComplete && message?.type === "pi_error") {
      this.fail(new Error(`runner ${this.runnerId}: ${message.error ?? "pi error"}`));
    }
    if (this.replayComplete && message?.type === "pi_exit" && !this.closed) {
      this.fail(new Error(`runner ${this.runnerId}: pi exited unexpectedly (${message.signal ?? message.code ?? "unknown"})`));
    }
  }

  fail(error) {
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters.clear();
  }

  async start() {
    const replayDone = this.waitFor((message) => message?.type === "replay_done", "event replay");
    void replayDone.promise.catch(() => {});
    const response = await fetch(`${this.baseUrl}/events?runner=${encodeURIComponent(this.runnerId)}&replay=1`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: this.controller.signal,
    });
    if (!response.ok || !response.body) {
      replayDone.cancel();
      throw new Error(`runner ${this.runnerId}: event stream failed (${response.status})`);
    }
    void this.read(response.body).catch((error) => { if (!this.closed) this.fail(error); });
    await replayDone.promise;
  }

  async read(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data = [];
    const consumeLine = (rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) {
        if (!data.length) return;
        const payload = data.join("\n");
        data = [];
        try { this.dispatch(JSON.parse(payload)); } catch {}
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

async function rpc(baseUrl, runner, command, { waitForSettled = false } = {}) {
  const id = `switch-revive-${++rpcSequence}`;
  const responseWait = runner.feed.waitFor(
    (message) => message?.type === "response" && message.id === id,
    `${command.type} response`,
  );
  const settledWait = waitForSettled
    ? runner.feed.waitFor(
      (message) => message?.type === "agent_settled" || (message?.type === "agent_end" && message.willRetry !== true),
      `${command.type} completion`,
    )
    : null;
  void responseWait.promise.catch(() => {});
  if (settledWait) void settledWait.promise.catch(() => {});
  try {
    await api(baseUrl, `/rpc?runner=${encodeURIComponent(runner.id)}`, {
      method: "POST",
      body: { id, ...command },
    });
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
  async function worker() {
    while (!firstError) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await operation(items[index], index); }
      catch (error) { firstError ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (firstError) throw firstError;
}

async function reviveRunners(baseUrl, allRunners) {
  if (config.reviveCount < config.sessionCount) {
    throw new Error("PERF_SWITCH_REVIVE_COUNT must be at least PERF_SWITCH_SESSION_COUNT");
  }
  const targets = allRunners
    .map((runner) => ({ ...runner, number: sessionNumber(runner.sessionName) }))
    .filter((runner) => runner.number != null)
    .sort((left, right) => left.number - right.number)
    .slice(0, config.reviveCount);
  if (targets.length !== config.reviveCount) {
    throw new Error(`expected ${config.reviveCount} runners to revive, found ${targets.length}`);
  }

  const started = performance.now();
  let revived = 0;
  await mapLimit(targets, config.reviveConcurrency, async (runner) => {
    runner.feed = new EventFeed(baseUrl, runner.id);
    revivalFeeds.push(runner.feed);
    await runner.feed.start();
    const selected = await rpc(baseUrl, runner, { type: "set_model", provider: "mock", modelId: "e2e-mock" });
    if (selected?.provider !== "mock" || selected?.id !== "e2e-mock") {
      throw new Error(`runner ${runner.id}: selected unexpected model ${selected?.provider ?? "?"}/${selected?.id ?? "?"}`);
    }
    const marker = `[oyster-session-switch-revive session=${String(runner.number).padStart(3, "0")}]`;
    await rpc(baseUrl, runner, {
      type: "prompt",
      message: `${marker} Reply with exactly OK. Do not use tools.`,
    }, { waitForSettled: true });
    revived++;
    if (revived % 10 === 0 || revived === targets.length) console.log(`revived ${revived}/${targets.length} runners`);
  });

  const catalog = await api(baseUrl, "/runners");
  const alive = (catalog.runners ?? []).filter((runner) => runner.alive);
  const busy = alive.filter((runner) => runner.busy);
  if (alive.length !== targets.length) throw new Error(`expected ${targets.length} live runners, found ${alive.length}`);
  if (busy.length) throw new Error(`${busy.length} revived runner(s) remained busy`);
  return {
    count: targets.length,
    concurrency: config.reviveConcurrency,
    provider: "mock",
    model: "e2e-mock",
    durationMs: performance.now() - started,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function runBrowser(baseUrl, sessions) {
  const launchOptions = configureBrowserRuntime();
  browser = await chromium.launch({ headless: !config.headed, ...launchOptions });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#token=${encodeURIComponent(config.token)}`, { waitUntil: "domcontentloaded" });
  await page.locator("#connDot.ok").waitFor({ state: "visible", timeout: config.startupTimeoutMs });
  await page.locator("#input").waitFor({ state: "visible", timeout: config.startupTimeoutMs });
  const startupModal = page.locator("#overlay.open");
  if (await startupModal.isVisible()) {
    await startupModal.locator("[data-modal-cancel]").click();
    await page.locator("#overlay").waitFor({ state: "hidden", timeout: config.startupTimeoutMs });
  }
  await page.locator(".session-sidebar-name").filter({ hasText: /^LongCat perf 001$/ }).waitFor({
    state: "attached",
    timeout: config.startupTimeoutMs,
  });
  await page.locator("details.session-sidebar-cwd").evaluateAll((details) => {
    for (const item of details) item.open = true;
  });

  const switches = [];
  for (const session of sessions) {
    const exactName = new RegExp(`^${session.sessionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const entry = page.locator(".session-sidebar-entry").filter({
      has: page.locator(".session-sidebar-name").filter({ hasText: exactName }),
    }).first();
    const row = entry.locator(".session-sidebar-row");
    await row.scrollIntoViewIfNeeded();

    const started = performance.now();
    await row.click({ timeout: config.switchBudgetMs });
    await page.waitForFunction(
      ({ name, marker, latestMessage }) => {
        const current = [...document.querySelectorAll(".session-sidebar-entry.current .session-sidebar-name")]
          .some((element) => element.textContent?.trim() === name);
        const users = [...document.querySelectorAll("#messages .msg.user")];
        const renderedMessages = [...document.querySelectorAll("#messages .msg")];
        const latest = renderedMessages.at(-1);
        return current
          && users.at(-1)?.textContent?.includes(marker)
          && latest?.classList.contains(latestMessage.role)
          && latest?.textContent?.includes(latestMessage.text);
      },
      { name: session.sessionName, marker: session.marker, latestMessage: session.latestMessage },
      { timeout: config.switchBudgetMs },
    );
    const durationMs = performance.now() - started;
    const rendered = await page.locator("#messages .msg.user").last().innerText();
    if (!rendered.includes(session.marker)) {
      throw new Error(`${session.sessionName} rendered the wrong latest user message`);
    }
    switches.push({
      session: session.sessionName,
      runnerId: session.id,
      marker: session.marker,
      latestMessage: session.latestMessage,
      durationMs,
    });
    console.log(`switched ${session.sessionName}: ${durationMs.toFixed(1)} ms`);
  }

  const durations = switches.map((entry) => entry.durationMs);
  await context.close();
  return {
    switches,
    latencyMs: {
      minimum: Math.min(...durations),
      p50: percentile(durations, 0.50),
      p95: percentile(durations, 0.95),
      maximum: Math.max(...durations),
    },
  };
}

async function main() {
  if (!existsSync(config.dataDir)) throw new Error(`prepared .pi directory not found: ${config.dataDir}`);
  if (!existsSync(join(config.dataDir, "agent/oyster.sqlite"))) {
    throw new Error(`prepared Oyster database not found under: ${config.dataDir}`);
  }
  if (config.skipBuild) {
    docker(["image", "inspect", config.image]);
    console.log(`reusing image: ${config.image}`);
  } else {
    console.log(`building current source as ${config.image}`);
    docker(["build", "--file", join(ROOT, "Dockerfile"), "--tag", config.image, ROOT], { capture: false });
  }
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const startedAt = new Date();

  docker([
    "run", "--detach", "--rm", "--name", containerName,
    "--publish", `127.0.0.1:${port}:4000`,
    "--mount", `type=bind,src=${config.dataDir},dst=/var/lib/oyster-performance-fixture,readonly`,
    "--mount", "type=tmpfs,dst=/root/.pi,tmpfs-size=268435456",
    "--env", `OYSTER_TOKEN=${config.token}`,
    ...(config.revive ? ["--env", "E2E_MOCK_LLM=1"] : []),
    "--entrypoint", "/bin/sh",
    config.image,
    "-c", "cp -a /var/lib/oyster-performance-fixture/. /root/.pi/ && exec /usr/local/bin/docker-entrypoint.sh",
  ]);
  containerStarted = true;

  try {
    await waitForServer(baseUrl);
    const initial = await preparedSessions(baseUrl, { revived: false });
    if (initial.allRunners.some((runner) => runner.alive)) {
      throw new Error("prepared fixture started with an active runner");
    }
    const revival = config.revive ? await reviveRunners(baseUrl, initial.allRunners) : null;
    const prepared = revival ? await preparedSessions(baseUrl, { revived: true }) : initial;
    const browserResult = await runBrowser(baseUrl, prepared.sessions);
    const after = await api(baseUrl, "/runners");
    const aliveAfter = (after.runners ?? []).filter((runner) => runner.alive).length;
    const expectedAlive = revival?.count ?? 0;
    if (aliveAfter !== expectedAlive) {
      throw new Error(`expected ${expectedAlive} live runner(s) after switching, found ${aliveAfter}`);
    }
    const busyAfter = (after.runners ?? []).filter((runner) => runner.busy).length;
    if (busyAfter !== 0) throw new Error(`${busyAfter} runner(s) remained busy after switching`);

    report = {
      status: "complete",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      image: config.image,
      imageId: docker(["image", "inspect", "--format", "{{.Id}}", config.image]),
      dataDir: config.dataDir,
      fixtureMountReadOnly: true,
      baseUrl,
      sessionCount: config.sessionCount,
      perSwitchBudgetMs: config.switchBudgetMs,
      mode: revival ? "revived" : "dormant",
      revival,
      aliveRunnersAfter: aliveAfter,
      busyRunnersAfter: busyAfter,
      ...browserResult,
    };
    mkdirSync(dirname(config.reportPath), { recursive: true });
    writeFileSync(config.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${config.reportPath}`);
    console.log(`p50=${report.latencyMs.p50.toFixed(1)} ms p95=${report.latencyMs.p95.toFixed(1)} ms max=${report.latencyMs.maximum.toFixed(1)} ms`);
  } catch (error) {
    try {
      if (browser) {
        const pages = browser.contexts().flatMap((context) => context.pages());
        if (pages[0]) await pages[0].screenshot({ path: "/tmp/oyster-session-switch-failure.png", fullPage: true });
      }
    } catch {}
    try {
      const logs = docker(["logs", "--tail", "200", containerName]);
      if (logs) console.error(logs);
    } catch {}
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    browser = null;
    for (const feed of revivalFeeds) feed.close();
    revivalFeeds = [];
    if (containerStarted) {
      try { docker(["rm", "--force", containerName]); } catch {}
      containerStarted = false;
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
