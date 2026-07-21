// Container lifecycle for per-test isolation. Each spec calls
// ensureContainer() in beforeEach (starts one if needed) and
// teardownContainer() in afterEach (removes it). Tests may run in parallel:
// each worker/test grabs one host port from 4000..4018 using a lock file.

import { execSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, "..", ".e2e-state.json");
const LOCK_DIR = join(HERE, "..", ".port-locks");
const PORT_MIN = Number(process.env.E2E_PORT_MIN ?? 4000);
const PORT_MAX = Number(process.env.E2E_PORT_MAX ?? 4018);

const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const DEFAULT_IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui:published";
const SQLITE_IMAGE = process.env.PI_UI_SQLITE_IMAGE ?? "pi-lot-ui:sqlite";

let allocatedPort = null;
let lockFile = null;
let container = null;
let agentVolume = null;
let base = null;
let selectedImage = DEFAULT_IMAGE;
let selectedStore = "jsonl";

function sh(args) {
  return execSync(args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function running(name) {
  try { return sh(`docker ps --filter "name=^${name}$" --format "{{.Names}}"`).trim() === name; }
  catch { return false; }
}

function lockOwnerAlive(file) {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    if (!Number.isInteger(pid) || pid < 1) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function reachable() {
  try {
    const res = await fetch(`${base}/runners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    return res.status === 200;
  } catch { return false; }
}

function imageExists(image) { try { return !!sh(`docker images -q ${image}`); } catch { return false; } }

function allocatePort() {
  mkdirSync(LOCK_DIR, { recursive: true });
  const preferred = Number(process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? 0);
  const ports = [];
  const count = PORT_MAX - PORT_MIN + 1;
  for (let i = 0; i < count; i++) ports.push(PORT_MIN + ((preferred + i) % count));

  for (const port of ports) {
    const file = join(LOCK_DIR, `${port}.lock`);
    try {
      const fd = openSync(file, "wx");
      closeSync(fd);
      writeFileSync(file, `${process.pid}\n`);
      allocatedPort = port;
      lockFile = file;
      container = `pi-lot-e2e-${port}`;
      agentVolume = `pi-lot-e2e-agent-${port}`;
      base = `http://localhost:${port}`;
      process.env.PI_UI_URL = base;
      process.env.PI_UI_CONTAINER = container;
      process.env.PI_UI_TOKEN = TOKEN;
      return;
    } catch {
      // If a previous crashed run left a lock behind but no matching container
      // exists, reclaim it. Otherwise leave it for the active parallel test.
      const staleContainer = `pi-lot-e2e-${port}`;
      if (!lockOwnerAlive(file) && !running(staleContainer)) {
        try { rmSync(file, { force: true }); } catch {}
        try {
          const fd = openSync(file, "wx");
          closeSync(fd);
          writeFileSync(file, `${process.pid}\n`);
          allocatedPort = port;
          lockFile = file;
          container = staleContainer;
          agentVolume = `pi-lot-e2e-agent-${port}`;
          base = `http://localhost:${port}`;
          process.env.PI_UI_URL = base;
          process.env.PI_UI_CONTAINER = container;
          process.env.PI_UI_TOKEN = TOKEN;
          return;
        } catch {}
      }
    }
  }
  throw new Error(`no free e2e ports in ${PORT_MIN}..${PORT_MAX}`);
}

async function waitUntilReachable() {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (await reachable()) {
      console.log(`[e2e] container ${container} up`);
      writeFileSync(STATE_FILE, JSON.stringify({ container, agentVolume, base, port: allocatedPort, startedByUs: true, mock: true, store: selectedStore }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`container ${container} did not come up within 60s`);
}

function startContainer() {
  console.log(`[e2e] starting ${selectedStore} mock container ${container} on ${base} with volume ${agentVolume} …`);
  sh(`docker run -d --name ${container} -p "${allocatedPort}:4000" -v "${agentVolume}:/root/.pi/agent" -e "PI_UI_TOKEN=${TOKEN}" -e "E2E_MOCK_LLM=1" -e "PERSISTENT_STORE=${selectedStore}" ${selectedImage}`);
}

// Start a container if one isn't already reachable — records state so
// teardown knows to remove it. The named agent volume deliberately survives
// replaceContainer() so persistence tests exercise a real container restart.
export async function ensureContainer({ sqlite = false } = {}) {
  selectedImage = sqlite ? SQLITE_IMAGE : DEFAULT_IMAGE;
  selectedStore = sqlite ? "sqlite" : "jsonl";
  if (allocatedPort == null) allocatePort();
  if (running(container) && (await reachable())) return;

  try { sh(`docker rm -f ${container}`); } catch {}
  try {
    const publishing = sh(`docker ps --filter "publish=${allocatedPort}" --format "{{.Names}}"`);
    for (const name of publishing.split("\n").filter(Boolean)) {
      try { sh(`docker rm -f ${name}`); } catch {}
    }
  } catch {}

  if (!imageExists(selectedImage)) {
    throw new Error(`e2e image ${selectedImage} is missing; run the documented container build first`);
  }

  try { sh(`docker volume rm -f ${agentVolume}`); } catch {}
  startContainer();
  await waitUntilReachable();
}

/** Replace the current container while retaining its agent volume. */
export async function replaceContainer({ sqlite = selectedStore === "sqlite" } = {}) {
  if (!container || !agentVolume) throw new Error("e2e container has not been allocated");
  selectedImage = sqlite ? SQLITE_IMAGE : DEFAULT_IMAGE;
  selectedStore = sqlite ? "sqlite" : "jsonl";
  if (!imageExists(selectedImage)) throw new Error(`e2e image ${selectedImage} is missing`);
  try { sh(`docker rm -f ${container}`); } catch {}
  startContainer();
  await waitUntilReachable();
}

// Remove the container and its isolated agent volume (called in afterEach).
export function teardownContainer() {
  if (!container) return;
  console.log(`[e2e] tearing down container ${container} and volume ${agentVolume}`);
  try { execSync(`docker rm -f ${container}`, { stdio: "pipe" }); } catch {}
  try { execSync(`docker volume rm -f ${agentVolume}`, { stdio: "pipe" }); } catch {}
  try { rmSync(STATE_FILE, { force: true }); } catch {}
  try { if (lockFile) rmSync(lockFile, { force: true }); } catch {}
  allocatedPort = null;
  lockFile = null;
  container = null;
  agentVolume = null;
  base = null;
  selectedImage = DEFAULT_IMAGE;
  selectedStore = "jsonl";
}
