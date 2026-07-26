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
  token: String(process.env.PI_UI_TOKEN ?? "session-switch-performance"),
  sessionCount: positiveInteger("PERF_SWITCH_SESSION_COUNT", 20),
  switchBudgetMs: positiveInteger("PERF_SWITCH_BUDGET_MS", 3_000),
  startupTimeoutMs: positiveInteger("PERF_SWITCH_STARTUP_TIMEOUT_MS", 60_000),
  reportPath: resolve(process.env.PERF_SWITCH_REPORT ?? "/tmp/oyster-session-switch-performance.json"),
  headed: process.env.PERF_SWITCH_HEADED === "1",
});

const containerName = `oyster-session-switch-${process.pid}`;
let browser = null;
let containerStarted = false;
let report = null;

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

async function api(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}): ${data.error ?? response.statusText}`);
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

async function preparedSessions(baseUrl) {
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
    const latestUser = messages.filter((message) => message?.role === "user").at(-1);
    const marker = `[oyster-longcat-perf session=${session.number} message=100]`;
    if (!messageText(latestUser?.content).includes(marker)) {
      throw new Error(`${session.sessionName} does not end with expected user marker ${marker}`);
    }
    session.marker = marker;
    session.latestMessage = latestMessageExpectation(messages.at(-1), marker);
  }
  return { allRunners: catalog.runners ?? [], sessions };
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
    "--env", `PI_UI_TOKEN=${config.token}`,
    "--entrypoint", "/bin/sh",
    config.image,
    "-c", "cp -a /var/lib/oyster-performance-fixture/. /root/.pi/ && exec /usr/local/bin/docker-entrypoint.sh",
  ]);
  containerStarted = true;

  try {
    await waitForServer(baseUrl);
    const prepared = await preparedSessions(baseUrl);
    if (prepared.allRunners.some((runner) => runner.alive)) {
      throw new Error("prepared image started with an active runner");
    }
    const browserResult = await runBrowser(baseUrl, prepared.sessions);
    const after = await api(baseUrl, "/runners");
    const aliveAfter = (after.runners ?? []).filter((runner) => runner.alive).length;
    if (aliveAfter !== 0) throw new Error(`session switching activated ${aliveAfter} runner(s)`);

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
      aliveRunnersAfter: aliveAfter,
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
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    browser = null;
    if (containerStarted) {
      try { docker(["rm", "--force", containerName]); } catch {}
      containerStarted = false;
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  try {
    const logs = docker(["logs", "--tail", "100", containerName]);
    if (logs) console.error(logs);
  } catch {}
  process.exitCode = 1;
});
