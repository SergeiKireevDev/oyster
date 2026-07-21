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
const IMAGE = process.env.PI_UI_IMAGE ?? "pi-lot-ui:published";
const SQLITE_IMAGE = process.env.PI_UI_SQLITE_IMAGE ?? "pi-lot-ui:sqlite";
const PI_SOURCE = process.env.PI_SOURCE_CONTEXT ?? "/home/ubuntu/pi-coding-agent";

const sh = (args, opts = {}) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const imageExists = (image = IMAGE) => { try { return !!sh(["images", "-q", image]).trim(); } catch { return false; } };

export default async function globalSetup() {
  // Clean stale parallel-test containers and lock files from previous aborted runs.
  try {
    const names = sh(["ps", "-a", "--filter", "name=^pi-lot-e2e-[0-9]+$", "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean);
    for (const name of names) {
      console.log(`[e2e] removing stale container ${name}`);
      try { sh(["rm", "-f", name]); } catch {}
    }
    const volumes = sh(["volume", "ls", "--filter", "name=^pi-lot-e2e-agent-[0-9]+$", "--format", "{{.Name}}"]).trim().split("\n").filter(Boolean);
    for (const volume of volumes) {
      console.log(`[e2e] removing stale volume ${volume}`);
      try { sh(["volume", "rm", "-f", volume]); } catch {}
    }
  } catch {}
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(LOCK_DIR, { recursive: true });

  // The verified loop builds the current worktree as `pi-lot-ui` immediately
  // before E2E. Point the default published-package test tag at that fresh
  // image so an older cached tag cannot run stale UI code.
  if (!process.env.PI_UI_IMAGE && imageExists("pi-lot-ui")) {
    sh(["tag", "pi-lot-ui", IMAGE]);
  }

  if (!imageExists()) {
    console.log(`[e2e] building published JSONL image ${IMAGE} …`);
    sh(["build", "-t", IMAGE, "."], { cwd: REPO_ROOT, stdio: "inherit" });
  }

  const sqliteImageExists = () => {
    try { return !!sh(["images", "-q", SQLITE_IMAGE]).trim(); } catch { return false; }
  };
  if (!sqliteImageExists()) {
    let revision;
    try { revision = execFileSync("git", ["-C", PI_SOURCE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
    catch { throw new Error(`local pi source is unavailable at ${PI_SOURCE}`); }
    console.log(`[e2e] building SQLite image ${SQLITE_IMAGE} from ${PI_SOURCE} (${revision}) …`);
    sh([
      "build", "-f", "Dockerfile.local-pi",
      "--build-context", `pi-source=${PI_SOURCE}`,
      "--build-arg", `PI_LOCAL_REV=${revision}`,
      "-t", SQLITE_IMAGE, ".",
    ], { cwd: REPO_ROOT, stdio: "inherit" });
  }
}
