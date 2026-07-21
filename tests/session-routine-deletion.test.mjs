import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTINES_MODULE = new URL("../server/routines.mjs", import.meta.url).href;
const APP_STORE_MODULE = new URL("../server/persistence/appStore.mjs", import.meta.url).href;

test("deleting a session removes its owned routine definitions instead of releasing them", (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-ui-routine-owner-delete-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const script = `
    import { createRoutine, deleteSessionRoutines, listRoutines, releaseRoutine } from ${JSON.stringify(ROUTINES_MODULE)};
    import { openAppStore } from ${JSON.stringify(APP_STORE_MODULE)};
    import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    const dir = join(process.env.HOME, ".pi", "routines");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orphan.sh"), "#!/bin/sh\\n"); chmodSync(join(dir, "orphan.sh"), 0o755);
    writeFileSync(join(dir, "bindings.json"), JSON.stringify({ "orphan.sh": { sessionId: "session-a", cwd: "/legacy" } }));
    const store = openAppStore({ databasePath: join(process.env.HOME, "app.sqlite") });
    const state = { appStore: store, serverEvent() {} };
    const owner = (sessionId) => store.repositories.sessions.upsert({ backend: "sqlite", sessionId, storagePath: "/agent/sessions.sqlite", createdAt: "created" });
    const ownerA = owner("session-a"), ownerB = owner("session-b"), ownerFork = owner("session-fork");
    createRoutine(state, { name: "owned.sh", script: "#!/bin/sh\\n", sessionId: "session-a", ownerId: ownerA.id, cwd: "/work/a" });
    createRoutine(state, { name: "fork.sh", script: "#!/bin/sh\\n", sessionId: "session-fork", ownerId: ownerFork.id, cwd: "/work/fork" });
    createRoutine(state, { name: "global.sh", script: "#!/bin/sh\\n" });
    createRoutine(state, { name: "rebound.sh", script: "#!/bin/sh\\n", sessionId: "session-a", ownerId: ownerA.id, cwd: "/work/a" });
    releaseRoutine(state, "rebound.sh");
    createRoutine(state, { name: "rebound.sh", script: "#!/bin/sh\\n", sessionId: "session-b", ownerId: ownerB.id, cwd: "/work/b" });
    const deleted = deleteSessionRoutines(state, "session-a");
    const rows = store.repositories.routines.list();
    console.log(JSON.stringify({ deleted, names: listRoutines(state).map((item) => item.name).sort(), ownedExists: existsSync(join(dir, "owned.sh")), rows }));
    store.close();
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(output.deleted, ["owned.sh"]);
  assert.deepEqual(output.names, ["fork.sh", "global.sh", "rebound.sh"]);
  assert.equal(output.ownedExists, false);
  assert.equal(output.rows.find((row) => row.name === "rebound.sh").session_id, "session-b");
  assert.equal(output.rows.some((row) => row.name === "owned.sh"), false);
  assert.equal(output.rows.find((row) => row.name === "global.sh").owner_id, null);
  assert.equal(output.rows.find((row) => row.name === "fork.sh").session_id, "session-fork");
});
