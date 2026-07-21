import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { assertStableStateInventory, STABLE_STATE_INVENTORY } from "../server/persistence/stateInventory.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(fileURLToPath(new URL("../server/server.mjs", import.meta.url)));

function productionModules() {
  const files = [];
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else if (name.endsWith(".mjs")) files.push(child);
    }
  };
  for (const name of readdirSync(root)) if (name.endsWith(".mjs")) files.push(join(root, name));
  visit(join(root, "persistence"));
  visit(join(root, "http"));
  return files;
}

test("every stable state field has a repository or explicit non-durable classification", (t) => {
  const observed = new Set();
  for (const path of productionModules()) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bstate\.([A-Za-z_$][\w$]*)/g)) observed.add(match[1]);
  }
  const unknown = [...observed].filter((field) => !STABLE_STATE_INVENTORY[field]).sort();
  assert.deepEqual(unknown, [], `classify new stable state fields: ${unknown.join(", ")}`);

  const dbRoot = mkdtempSync(join(tmpdir(), "pi-ui-state-inventory-"));
  const store = openAppStore({ databasePath: join(dbRoot, "app.sqlite") });
  t.after(() => { store.close(); rmSync(dbRoot, { recursive: true, force: true }); });
  for (const [field, metadata] of Object.entries(STABLE_STATE_INVENTORY)) {
    assert.ok(["persistent", "rebuildable", "ephemeral", "startup"].includes(metadata.classification), `invalid classification for ${field}`);
    if (["persistent", "rebuildable"].includes(metadata.classification)) {
      assert.ok(metadata.repository, `${field} must name its authoritative repository`);
      assert.ok(store.repositories[metadata.repository], `${field} names missing repository ${metadata.repository}`);
    }
  }
});

test("stable-core construction rejects an unclassified field", () => {
  assert.equal(assertStableStateInventory({ config: {}, appStore: {} }), true);
  assert.throws(() => assertStableStateInventory({ config: {}, surpriseDurableValue: 1 }), /surpriseDurableValue has no durability classification/);
});
