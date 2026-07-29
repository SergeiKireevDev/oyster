// E2E global setup for the parallel suite.
//
// Individual tests start their own mock oyster containers via lib/reset.js.
// This setup only prepares the SQLite image once and clears stale
// containers/port locks from interrupted earlier runs.

import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const LOCK_DIR = process.env.E2E_LOCK_DIR ?? join(HERE, ".port-locks");
const IMAGE = process.env.OYSTER_IMAGE ?? "oyster:sqlite";
const PI_SOURCE = process.env.PI_SOURCE_CONTEXT ?? join(REPO_ROOT, "pi");
const CONTAINER_PREFIX = process.env.E2E_CONTAINER_PREFIX ?? "oyster-e2e";
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(CONTAINER_PREFIX)) throw new Error("invalid E2E_CONTAINER_PREFIX");

const sh = (args, opts = {}) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const imageExists = () => { try { return !!sh(["images", "-q", IMAGE]).trim(); } catch { return false; } };

export default async function globalSetup() {
  // Clean stale parallel-test containers and lock files from previous aborted runs.
  try {
    const names = sh(["ps", "-a", "--filter", `name=^${CONTAINER_PREFIX}-[0-9]+$`, "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean);
    for (const name of names) {
      console.log(`[e2e] removing stale container ${name}`);
      try { sh(["rm", "-f", name]); } catch {}
    }
    const volumes = sh(["volume", "ls", "--filter", `name=^${CONTAINER_PREFIX}-agent-[0-9]+$`, "--format", "{{.Name}}"]).trim().split("\n").filter(Boolean);
    for (const volume of volumes) {
      console.log(`[e2e] removing stale volume ${volume}`);
      try { sh(["volume", "rm", "-f", volume]); } catch {}
    }
  } catch {}
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(LOCK_DIR, { recursive: true });

  if (imageExists()) return;

  let revision;
  try { revision = execFileSync("git", ["-C", PI_SOURCE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { throw new Error(`local pi source is unavailable at ${PI_SOURCE}`); }
  console.log(`[e2e] building SQLite image ${IMAGE} from ${PI_SOURCE} (${revision}) …`);
  sh([
    "build", "-f", "Dockerfile.local-pi",
    "--build-context", `pi-source=${PI_SOURCE}`,
    "--build-arg", `PI_LOCAL_REV=${revision}`,
    "-t", IMAGE, ".",
  ], { cwd: REPO_ROOT, stdio: "inherit" });
}
