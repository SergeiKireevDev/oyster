import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = new URL("../server.mjs", import.meta.url);

test("an application database migration failure exits before the HTTP server listens", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-invalid-app-store-"));
  const databasePath = join(root, "pi-lot-ui.sqlite");
  writeFileSync(databasePath, "not a sqlite database");
  const result = spawnSync(process.execPath, [
    SERVER.pathname,
    "--pi", process.execPath,
    "--host", "127.0.0.1",
    "--port", "0",
    "--token", "test-token",
  ], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      HOME: root,
      PERSISTENT_STORE: "jsonl",
      PI_UI_DB_PATH: databasePath,
    },
  });
  rmSync(root, { recursive: true, force: true });

  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.stdout, /listening on/);
  assert.match(result.stderr, /database|file is not a database/i);
});
