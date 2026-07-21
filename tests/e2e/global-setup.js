// E2E global setup for the parallel suite.
//
// Individual tests start their own mock pi-lot-ui containers via lib/reset.js.
// This setup only prepares the image once and clears stale containers/port locks
// from interrupted earlier runs. Live tests then allocate ports 4000..4018.

import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const LOCK_DIR = join(HERE, ".port-locks");
const IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui";

const sh = (args, opts = {}) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const imageExists = () => { try { return !!sh(["images", "-q", IMAGE]).trim(); } catch { return false; } };

export default async function globalSetup() {
  // Clean stale parallel-test containers and lock files from previous aborted runs.
  try {
    const names = sh(["ps", "-a", "--filter", "name=^pi-lot-e2e-[0-9]+$", "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean);
    for (const name of names) {
      console.log(`[e2e] removing stale container ${name}`);
      try { sh(["rm", "-f", name]); } catch {}
    }
  } catch {}
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(LOCK_DIR, { recursive: true });

  if (!imageExists()) {
    console.log(`[e2e] building image ${IMAGE} …`);
    sh(["build", "-t", IMAGE, "."], { cwd: REPO_ROOT, stdio: "inherit" });
  }
}
