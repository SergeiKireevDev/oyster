#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyAppData } from "../server/persistence/legacyDataImport.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log("usage: npm run migrate-app-data -- [--dry-run|--apply] --service-stopped");
  process.exit(0);
}
if (args.has("--dry-run") && args.has("--apply")) throw new Error("choose either --dry-run or --apply");
const mode = args.has("--apply") ? "apply" : "dry-run";
if (!args.has("--service-stopped")) throw new Error("refusing import without --service-stopped confirmation");
const agentDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const databasePath = resolve(process.env.PI_UI_DB_PATH ?? join(agentDir, "oyster.sqlite"));
const jsonlRoot = resolve(process.env.PI_SESSION_DIR ?? join(agentDir, "sessions"));
const sqlitePath = resolve(process.env.PI_SQLITE_PATH ?? join(agentDir, "sessions.sqlite"));
const appStore = openAppStore({ databasePath });
try {
  const sessionReferences = createSessionReferenceCodec({ agentDir, jsonlRoot, sqlitePath });
  const report = await importLegacyAppData({
    appStore, mode, serviceStopped: true, sessionReferences,
    resolveOwner(sessionId) {
      const owners = appStore.repositories.sessions.listBySessionId(sessionId);
      if (owners.length > 1) throw new Error(`legacy routine binding ${sessionId} matches multiple session owners`);
      return owners[0] ?? null;
    },
    checkpointSourcePath: process.env.PI_LEGACY_CHECKPOINTS_PATH,
    routineSourceDir: process.env.PI_LEGACY_ROUTINES_DIR,
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  appStore.close();
}
