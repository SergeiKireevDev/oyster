// Brings up a SELF-CONTAINED pi-lot-ui container for the e2e suite.
//
// The image bundles a deterministic mock LLM (activated with E2E_MOCK_LLM=1),
// so there are NO credential mounts and NO external model calls — the whole
// stack (UI + agent + model) lives in one container on port 4000.
//
// It also removes any auth-mounted container still holding :4000 (e.g. an
// earlier `pi-lot-ui-test` run with volumes), since the mock container now
// owns that port.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, ".e2e-state.json");
const REPO_ROOT = join(HERE, "..", "..");
const BASE = process.env.PI_UI_URL ?? "http://localhost:4000";
const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
const IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui";
const CONTAINER = process.env.PI_UI_CONTAINER ?? "pi-lot-e2e";
const PORT = Number(new URL(BASE).port || 4000);

const sh = (args, opts = {}) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

async function reachable() {
  try {
    const res = await fetch(`${BASE}/runners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    return res.status === 200;
  } catch {
    return false;
  }
}

const running = (name) => {
  try { return sh(["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]).trim() === name; }
  catch { return false; }
};

const publishers = () => {
  try { return sh(["ps", "--filter", `publish=${PORT}`, "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean); }
  catch { return []; }
};

const imageExists = () => { try { return !!sh(["images", "-q", IMAGE]).trim(); } catch { return false; } };

export default async function globalSetup() {
  // reuse a healthy mock container across runs (fast)
  if (running(CONTAINER) && (await reachable())) {
    console.log(`[e2e] reusing running mock container ${CONTAINER}`);
    writeFileSync(STATE_FILE, JSON.stringify({ container: CONTAINER, startedByUs: false, mock: true }));
    return;
  }

  // free :4000 — remove our own stale container and any auth-mounted one holding it
  try { sh(["rm", "-f", CONTAINER]); } catch {}
  for (const name of publishers()) {
    console.log(`[e2e] removing container ${name} occupying :${PORT}`);
    try { sh(["rm", "-f", name]); } catch {}
  }

  if (!imageExists()) {
    console.log(`[e2e] building image ${IMAGE} …`);
    sh(["build", "-t", IMAGE, "."], { cwd: REPO_ROOT, stdio: "inherit" });
  }

  console.log(`[e2e] starting self-contained mock container ${CONTAINER} on :${PORT} …`);
  sh([
    "run", "-d", "--name", CONTAINER, "-p", `${PORT}:4000`,
    "-e", `PI_UI_TOKEN=${TOKEN}`,
    "-e", "E2E_MOCK_LLM=1",
    IMAGE,
  ]);

  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (await reachable()) {
      console.log(`[e2e] container ${CONTAINER} is up (bundled mock LLM)`);
      writeFileSync(STATE_FILE, JSON.stringify({ container: CONTAINER, startedByUs: true, mock: true }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`mock container did not come up on :${PORT} within 60s`);
}
