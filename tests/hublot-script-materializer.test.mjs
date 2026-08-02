import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeHublotStartupScriptRecord } from "../server/persistence/hublotScriptMaterializer.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-materializer-"));
  const agentDir = join(root, "agent");
  const id = "hublot-1";
  const source = "#!/bin/sh\n# oyster: idempotent\nexit 0\n";
  const record = {
    id,
    service_kind: "agent_managed",
    service_start_script: source,
    service_start_script_sha256: createHash("sha256").update(source).digest("hex"),
    service_start_script_path: join(agentDir, "hublots", id, "start.sh"),
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, agentDir, record, source };
}

test("hublot script materializer validates its record and allocated path", (t) => {
  const { agentDir, record } = fixture(t);

  assert.throws(
    () => materializeHublotStartupScriptRecord({ ...record, id: "../outside" }, { agentDir }),
    /invalid hublot id/,
  );
  assert.throws(
    () => materializeHublotStartupScriptRecord({ ...record, service_start_script: 42 }, { agentDir }),
    /startup source must be a non-empty string/,
  );
  assert.throws(
    () => materializeHublotStartupScriptRecord(record),
    /agent directory must be a non-empty string/,
  );
  assert.throws(
    () => materializeHublotStartupScriptRecord({ ...record, service_start_script_path: join(agentDir, "other.sh") }, { agentDir }),
    /startup path is outside its allocation/,
  );
});

test("hublot script materializer creates private artifacts and repairs permissive modes", (t) => {
  const { agentDir, record, source } = fixture(t);
  mkdirSync(join(agentDir, "hublots", record.id), { recursive: true });
  writeFileSync(record.service_start_script_path, source, { mode: 0o755 });
  chmodSync(record.service_start_script_path, 0o755);

  const restored = materializeHublotStartupScriptRecord(record, { agentDir });

  assert.equal(restored.rematerialized, true);
  assert.equal(readFileSync(restored.path, "utf8"), source);
  assert.equal(lstatSync(restored.path).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(agentDir, "hublots")).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(agentDir, "hublots", record.id)).mode & 0o777, 0o700);
  assert.equal(materializeHublotStartupScriptRecord(record, { agentDir }).rematerialized, false);
});

test("hublot script materializer refuses a symlinked allocation root", (t) => {
  const { root, agentDir, record } = fixture(t);
  const outside = join(root, "outside");
  mkdirSync(outside);
  mkdirSync(agentDir);
  symlinkSync(outside, join(agentDir, "hublots"));

  assert.throws(
    () => materializeHublotStartupScriptRecord(record, { agentDir }),
    /refusing to materialize through non-directory path/,
  );
  assert.deepEqual(readFileNames(outside), []);
});

test("hublot script materializer refuses a symlinked hublot directory", (t) => {
  const { root, agentDir, record } = fixture(t);
  const outside = join(root, "outside");
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(agentDir, "hublots"), { recursive: true });
  symlinkSync(outside, join(agentDir, "hublots", record.id));

  assert.throws(
    () => materializeHublotStartupScriptRecord(record, { agentDir }),
    /refusing to materialize through non-directory path/,
  );
  assert.deepEqual(readFileNames(outside), []);
});

function readFileNames(path) {
  return readdirSync(path);
}
