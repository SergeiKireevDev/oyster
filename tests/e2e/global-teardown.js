// Cleans up after the e2e run.
//
// With the bundled mock LLM (global-setup starts the self-contained `pi-lot-e2e`
// container with E2E_MOCK_LLM=1, there are no auth volumes to scrub):
//   - remove a container WE started
//   - leave a reused one running, just tidying the e2e artifacts in /workspace

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, ".e2e-state.json");

const sh = (args) => {
  try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { return ""; }
};

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return;
  let state;
  try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return; }
  const { container, startedByUs } = state;

  // best-effort: close any hublots the specs left open (they carry the marker)
  const BASE = process.env.PI_UI_URL ?? "http://localhost:4000";
  const TOKEN = process.env.PI_UI_TOKEN ?? "e2e-test-token";
  try {
    const res = await fetch(`${BASE}/tunnels`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const { tunnels = [] } = await res.json();
    for (const t of tunnels) {
      if (/e2e-btn-/.test(t.label ?? "")) {
        await fetch(`${BASE}/tunnels?id=${encodeURIComponent(t.id)}`, {
          method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` },
        }).catch(() => {});
      }
    }
  } catch {}

  if (startedByUs) {
    console.log(`[e2e] removing container ${container}`);
    sh(["rm", "-f", container]);
  } else if (container) {
    console.log(`[e2e] scrubbing e2e artifacts from reused container ${container}`);
    sh(["exec", container, "bash", "-lc",
      "rm -rf /workspace/.git /workspace/e2e-*.txt /workspace/.e2e-* /tmp/e2e-* ~/.pi/routines/e2e-*.sh 2>/dev/null || true"]);
  }
  try { rmSync(STATE_FILE, { force: true }); } catch {}
}
