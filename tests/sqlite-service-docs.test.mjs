import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../pi-ui.service", import.meta.url), "utf8");
const serviceDocs = readFileSync(new URL("../docs/operations/service.md", import.meta.url), "utf8");
const backupDocs = readFileSync(new URL("../docs/operations/backup-and-recovery.md", import.meta.url), "utf8");

test("systemd template pins the local SQLite-enabled pi runtime", () => {
  assert.match(service, /Environment=PI_BIN=\/home\/ubuntu\/pi-coding-agent\/packages\/coding-agent\/dist\/cli\.js/);
  assert.match(service, /Environment=PERSISTENT_STORE=sqlite/);
  assert.match(service, /Environment=PI_CODING_AGENT_DIR=\/home\/ubuntu\/\.pi\/agent/);
  assert.match(service, /WorkingDirectory=__PI_UI_DIR__/);
});

test("service documentation installs, verifies, updates, and rolls back the service", () => {
  assert.match(serviceDocs, /sed "s\|__PI_UI_DIR__\|\$\(pwd\)\|g" pi-ui\.service/);
  assert.match(serviceDocs, /systemctl --user restart pi-ui\.service/);
  assert.match(serviceDocs, /curl --fail http:\/\/127\.0\.0\.1:8080\/health/);
  assert.match(serviceDocs, /Environment=PERSISTENT_STORE=jsonl/);
});

test("SQLite backup guidance covers online backup and stopped WAL sidecars", () => {
  assert.match(backupDocs, /SQLite's backup API/);
  assert.match(backupDocs, /await backup\(source/);
  assert.match(backupDocs, /sessions\.sqlite"\{,-wal,-shm\}/);
  assert.match(backupDocs, /Stop the service before copying a database as files/);
  assert.match(backupDocs, /Apply the same closed-database rule to `oyster\.sqlite`/);
});
