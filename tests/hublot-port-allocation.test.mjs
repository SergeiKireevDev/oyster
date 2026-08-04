import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { allocateHublot, isLocalPortAvailable, reserveHublot } from "../server/tunnels.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-port-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("automatic allocation skips both live ports and durable reservations", async (t) => {
  const { state } = await fixture(t);
  await reserveHublot(state, { port: 3001 });
  const checked = [];
  const allocated = await allocateHublot(state, { label: "allocated" }, {
    startPort: 3000,
    checkPort: async (port) => { checked.push(port); return port !== 3000; },
  });
  assert.equal(allocated.port, 3002);
  assert.deepEqual(checked, [3000, 3002], "database-reserved ports must be skipped before the live check");
  assert.equal(allocated.status, "opening");
});

test("automatic allocation rejects invalid search bounds", async (t) => {
  const { state } = await fixture(t);
  for (const startPort of [0, 65536, 3.5, "not-a-port"]) {
    await assert.rejects(async () => await allocateHublot(state, {}, { startPort }), /invalid starting port/);
  }
  await assert.rejects(async () => await allocateHublot(state, {}, { checkPort: null }), /availability check must be a function/);
});

test("concurrent allocators reserve distinct ports transactionally", async (t) => {
  const { store, state } = await fixture(t);
  const [first, second] = await Promise.all([
    await allocateHublot(state, { label: "first" }, { startPort: 3100, checkPort: async () => true }),
    await allocateHublot(state, { label: "second" }, { startPort: 3100, checkPort: async () => true }),
  ]);
  assert.deepEqual([first.port, second.port].sort(), [3100, 3101]);
  assert.deepEqual((await store.repositories.hublots.list()).map((row) => row.port).sort(), [3100, 3101]);
});

test("live port checks bind the candidate instead of trusting process-local state", async (t) => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  assert.equal(await isLocalPortAvailable(port), false);
  server.close();
  await once(server, "close");
  assert.equal(await isLocalPortAvailable(port), true);
});

test("process-local next-port state is absent from the server and route", () => {
  const source = ["../server/server.mjs", "../server/http/routes/tunnelRoutes.mjs"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /nextHublotPort/);
  assert.match(source, /allocateHublot/);
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
