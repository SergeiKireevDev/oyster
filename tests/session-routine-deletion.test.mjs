import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTINES_MODULE = new URL("../routines.mjs", import.meta.url).href;

test("deleting a session removes its owned routine definitions instead of releasing them", (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-ui-routine-owner-delete-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const script = `
    import { createRoutine, deleteSessionRoutines, listRoutines, releaseRoutine } from ${JSON.stringify(ROUTINES_MODULE)};
    import { existsSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    const state = { serverEvent() {} };
    createRoutine(state, { name: "owned.sh", script: "#!/bin/sh\\n", sessionId: "session-a", cwd: "/work/a" });
    createRoutine(state, { name: "fork.sh", script: "#!/bin/sh\\n", sessionId: "session-fork", cwd: "/work/fork" });
    createRoutine(state, { name: "global.sh", script: "#!/bin/sh\\n" });
    createRoutine(state, { name: "rebound.sh", script: "#!/bin/sh\\n", sessionId: "session-a", cwd: "/work/a" });
    releaseRoutine(state, "rebound.sh");
    createRoutine(state, { name: "rebound.sh", script: "#!/bin/sh\\n", sessionId: "session-b", cwd: "/work/b" });
    const deleted = deleteSessionRoutines(state, "session-a");
    const dir = join(process.env.HOME, ".pi", "routines");
    const bindings = JSON.parse(readFileSync(join(dir, "bindings.json"), "utf8"));
    console.log(JSON.stringify({ deleted, names: listRoutines(state).map((item) => item.name).sort(), ownedExists: existsSync(join(dir, "owned.sh")), reboundOwner: bindings["rebound.sh"].sessionId, bindings }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(output.deleted, ["owned.sh"]);
  assert.deepEqual(output.names, ["fork.sh", "global.sh", "rebound.sh"]);
  assert.equal(output.ownedExists, false);
  assert.equal(output.reboundOwner, "session-b");
  assert.equal("owned.sh" in output.bindings, false);
  assert.equal("global.sh" in output.bindings, false);
  assert.equal(output.bindings["fork.sh"].sessionId, "session-fork");
});
