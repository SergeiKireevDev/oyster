import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";

test("app store creates its database directory and closes idempotently", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-app-store-"));
  const databasePath = join(root, "nested", "pi-lot-ui.sqlite");
  const store = openAppStore({ databasePath });
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(store.path, resolve(databasePath));
  assert.equal(existsSync(databasePath), true);
  assert.deepEqual(store.repositories, {});
  assert.equal(Object.isFrozen(store.repositories), true);
  assert.equal(store.closed, false);

  store.close();
  store.close();
  assert.equal(store.closed, true);
});

test("app store closes its owned database exactly once", () => {
  let openedPath = null;
  let closes = 0;
  class FakeDatabase {
    constructor(path) { openedPath = path; }
    close() { closes++; }
  }

  const databasePath = join(tmpdir(), "pi-ui-fake-store.sqlite");
  const store = openAppStore({ databasePath, Database: FakeDatabase });
  store.close();
  store.close();

  assert.equal(openedPath, resolve(databasePath));
  assert.equal(closes, 1);
});
