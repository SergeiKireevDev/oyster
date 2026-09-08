import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { reserveHublot } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-port-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("process-local next-port state is absent from the server and route", () => {
  const source = ["../server/server.mjs", "../server/http/routes/tunnelRoutes.mjs"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /nextHublotPort/);
  assert.doesNotMatch(source, /allocateHublot/);
});

test("active-port uniqueness is enforced by SQLite and closed ports are reusable", async (t) => {
  const { store, state } = await fixture(t);
  const first = await reserveHublot(state, { port: 3200 });
  await assert.rejects(() => store.repositories.hublots.create({
    id: "conflict", port: 3200, workdir: "/workspace", serviceKind: "self_served",
    status: "opening", desiredState: "open", createdAt: "created",
  }), /unique constraint/i);
  await store.repositories.hublots.update(first.id, { status: "closed", desired_state: "closed" });
  assert.equal((await reserveHublot(state, { port: 3200 })).port, 3200);
});
