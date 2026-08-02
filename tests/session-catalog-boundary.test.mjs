import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "oyster-session-boundary-"));
process.env.HOME = home;

const sessions = await import("../server/sessions.mjs");

after(() => rmSync(home, { recursive: true, force: true }));

test("sessions compatibility boundary exposes the intentional JSONL API", () => {
  assert.deepEqual(Object.keys(sessions).sort(), [
    "SESSIONS_ROOT",
    "createJsonlSessionCatalog",
    "decodeFolderName",
    "findSessionById",
    "forkSessionAt",
    "labelOf",
    "listSessionFolders",
    "listSessions",
    "parseSessionFile",
    "readSessionHeaderInfo",
    "searchSessionFile",
    "searchSessions",
    "sessionCatalog",
    "sessionDirFor",
    "sessionEntries",
    "sessionFileFromSearch",
    "sessionFileNameParam",
    "sessionFileParam",
    "sessionMessages",
    "sessionTree",
    "summarizeSessionFile",
    "textOf",
    "transcriptMessage",
  ].sort());
});

test("default session catalog is the shared frozen JSONL adapter", () => {
  assert.equal(sessions.sessionCatalog.backend, "jsonl");
  assert.equal(sessions.sessionCatalog.root, sessions.SESSIONS_ROOT);
  assert.equal(sessions.sessionCatalog.locationForCwd, sessions.sessionDirFor);
  assert.ok(Object.isFrozen(sessions.sessionCatalog));
});
