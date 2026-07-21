import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../pi-ui.service", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("systemd template pins the local SQLite-enabled pi runtime", () => {
  assert.match(service, /Environment=PI_BIN=\/home\/ubuntu\/pi-coding-agent\/packages\/coding-agent\/dist\/cli\.js/);
  assert.match(service, /Environment=PERSISTENT_STORE=sqlite/);
  assert.match(service, /Environment=PI_CODING_AGENT_DIR=\/home\/ubuntu\/\.pi\/agent/);
  assert.match(service, /WorkingDirectory=__PI_UI_DIR__/);
});

test("service documentation builds, installs, verifies, and rolls back the local pi", () => {
  assert.match(readme, /npm -C \/home\/ubuntu\/pi-coding-agent run build/);
  assert.match(readme, /sed "s\|__PI_UI_DIR__\|\$\(pwd\)\|g" pi-ui\.service/);
  assert.match(readme, /systemctl --user restart pi-ui\.service/);
  assert.match(readme, /curl -fsS http:\/\/127\.0\.0\.1:8080\/health/);
  assert.match(readme, /Environment=PERSISTENT_STORE=jsonl/);
});

test("SQLite backup guidance covers online backup and stopped WAL sidecars", () => {
  assert.match(readme, /Node's SQLite backup API/);
  assert.match(readme, /await backup\(source/);
  assert.match(readme, /sessions\.sqlite"\{,-wal,-shm\}/);
  assert.match(readme, /copying only `sessions\.sqlite` while[\s\S]*not a valid backup/);
  assert.match(readme, /Switching backends does not migrate or delete either store/);
});
