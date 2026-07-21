// Container lifecycle for per-test isolation. Each spec calls
// ensureContainer() in beforeEach (starts one if needed) and
// teardownContainer() in afterEach (removes it). So desktop and mobile
// variants get independent workspaces even though they live in the same file.

import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, "..", ".e2e-state.json");

const BASE = process.env.PI_UI_URL ?? "http://localhost:4000";
const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui";
const CONTAINER = process.env.PI_UI_CONTAINER ?? "pi-lot-e2e";

function sh(args) {
  return execSync(args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function reachable() {
  try {
    const res = await fetch(`${BASE}/runners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    return res.status === 200;
  } catch { return false; }
}

function imageExists() { try { return !!sh(`docker images -q ${IMAGE}`); } catch { return false; } }

// Start a container if one isn't already reachable — records state so
// teardown knows to remove it.
export async function ensureContainer() {
  if (running(CONTAINER) && (await reachable())) return;
  // free the port
  try { sh(`docker rm -f ${CONTAINER}`); } catch {}
  try {
    const publishing = sh(`docker ps --filter "publish=${new URL(BASE).port || 4000}" --format "{{.Names}}"`);
    for (const name of publishing.split("\n").filter(Boolean)) {
      try { sh(`docker rm -f ${name}`); } catch {}
    }
  } catch {}

  if (!imageExists()) {
    console.log(`[e2e] building image ${IMAGE} …`);
    sh(`docker build -t ${IMAGE} "${join(HERE, "..", "..")}"`);
  }

  console.log(`[e2e] starting self-contained mock container ${CONTAINER} on ${BASE} …`);
  sh(`docker run -d --name ${CONTAINER} -p "${(new URL(BASE).port || 4000)}:4000" -e "PI_UI_TOKEN=${TOKEN}" -e "E2E_MOCK_LLM=1" ${IMAGE}`);

  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (await reachable()) {
      console.log(`[e2e] container ${CONTAINER} up`);
      writeFileSync(STATE_FILE, JSON.stringify({ container: CONTAINER, startedByUs: true, mock: true }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`container ${CONTAINER} did not come up within 60s`);
}

function running(name) {
  try { return sh(`docker ps --filter "name=^${name}$" --format "{{.Names}}"`).trim() === name; }
  catch { return false; }
}

// Remove the container (called in afterEach)
export function teardownContainer() {
  console.log(`[e2e] tearing down container ${CONTAINER}`);
  try { execSync(`docker rm -f ${CONTAINER}`, { stdio: "pipe" }); } catch {}
  try { rmSync(STATE_FILE, { force: true }); } catch {}
}
