// E2E global teardown for the parallel suite. Per-test afterEach hooks remove
// their own containers; this is just a final best-effort sweep for failures.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_DIR = join(HERE, ".port-locks");
const STATE_FILE = join(HERE, ".e2e-state.json");

const sh = (args) => {
  try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { return ""; }
};

export default async function globalTeardown() {
  const names = sh(["ps", "-a", "--filter", "name=^oyster-e2e-[0-9]+$", "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean);
  for (const name of names) {
    console.log(`[e2e] removing leftover container ${name}`);
    sh(["rm", "-f", name]);
  }
  const volumes = sh(["volume", "ls", "--filter", "name=^oyster-e2e-agent-[0-9]+$", "--format", "{{.Name}}"]).trim().split("\n").filter(Boolean);
  for (const volume of volumes) {
    console.log(`[e2e] removing leftover volume ${volume}`);
    sh(["volume", "rm", "-f", volume]);
  }
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  try { rmSync(STATE_FILE, { force: true }); } catch {}
}
