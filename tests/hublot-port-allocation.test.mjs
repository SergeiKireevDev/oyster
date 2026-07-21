import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { allocateHublot, isLocalPortAvailable, reserveHublot } from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-hublot-port-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const state = { appStore: store, config: { PI_AGENT_DIR: join(root, "agent") }, currentDir: root };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state };
}

test("automatic allocation skips both live ports and durable reservations", async (t) => {
  const { state } = fixture(t);
  reserveHublot(state, { port: 3001 });
  const checked = [];
  const allocated = await allocateHublot(state, { label: "allocated" }, {
    startPort: 3000,
    checkPort: async (port) => { checked.push(port); return port !== 3000; },
  });
  assert.equal(allocated.port, 3002);
  assert.deepEqual(checked, [3000, 3002], "database-reserved ports must be skipped before the live check");
  assert.equal(allocated.status, "opening");
});

test("concurrent allocators reserve distinct ports transactionally", async (t) => {
  const { store, state } = fixture(t);
  const [first, second] = await Promise.all([
    allocateHublot(state, { label: "first" }, { startPort: 3100, checkPort: async () => true }),
    allocateHublot(state, { label: "second" }, { startPort: 3100, checkPort: async () => true }),
  ]);
  assert.deepEqual([first.port, second.port].sort(), [3100, 3101]);
  assert.deepEqual(store.repositories.hublots.list().map((row) => row.port).sort(), [3100, 3101]);
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

test("active-port uniqueness is enforced by SQLite and closed ports are reusable", (t) => {
  const { store, state } = fixture(t);
  const first = reserveHublot(state, { port: 3200 });
  assert.throws(() => store.repositories.hublots.create({
    id: "conflict", port: 3200, workdir: "/workspace", serviceKind: "self_served",
    status: "opening", desiredState: "open", createdAt: "created",
  }), /unique constraint/i);
  store.repositories.hublots.update(first.id, { status: "closed", desired_state: "closed" });
  assert.equal(reserveHublot(state, { port: 3200 }).port, 3200);
});
