import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateCatalogAccess,
  validateDependencyConstruction,
  validateRepositoryAvailability,
} from "../server/application-candidate.mjs";

const repositoryProbes = {
  checkpoints: "listForSession",
  hublots: "list",
  operations: "listIncomplete",
  pinnedWidgets: "list",
  routines: "list",
  runnerEvents: "list",
  runners: "list",
  sessions: "find",
};

function appStore(overrides = {}) {
  const repositories = Object.fromEntries(Object.entries(repositoryProbes).map(([name, method]) => [
    name,
    { [method]() { return []; } },
  ]));
  return { repositories, hydrate: () => ({ incompleteOperations: [] }), ...overrides };
}

function catalog(overrides = {}) {
  const value = { backend: "jsonl" };
  for (const method of ["entries", "findById", "folders", "messages", "readHeader", "search", "summarize", "tree"]) {
    value[method] = () => null;
  }
  value.list = () => [];
  return { ...value, ...overrides };
}

test("repository preflight requires every application boundary and probes the stable connection", async () => {
  let hydrated = 0;
  const store = appStore({
    hydrate() { hydrated += 1; return { incompleteOperations: [] }; },
  });
  assert.deepEqual(await validateRepositoryAvailability(store), { incompleteOperations: [] });
  assert.equal(hydrated, 1);

  delete store.repositories.pinnedWidgets;
  await assert.rejects(
    async () => await validateRepositoryAvailability(store),
    /repository "pinnedWidgets" is unavailable \(missing list\(\)\)/,
  );
  assert.equal(hydrated, 1, "an incomplete registry must fail before database access");

  await assert.rejects(
    async () => await validateRepositoryAvailability(appStore({ hydrate: () => ({}) })),
    (error) => error.message === "application repository access failed"
      && error.cause?.message.includes("invalid snapshot"),
  );
});

test("repository and catalog access failures retain their original causes", async () => {
  const databaseFailure = new Error("database is closed");
  await assert.rejects(
    async () => await validateRepositoryAvailability(appStore({ hydrate() { throw databaseFailure; } })),
    (error) => error.message === "application repository access failed" && error.cause === databaseFailure,
  );

  const catalogFailure = new Error("malformed session schema");
  await assert.rejects(
    async () => await validateCatalogAccess(catalog({ list() { throw catalogFailure; } }), { backend: "jsonl", cwd: "/workspace" }),
    (error) => error.message === "cannot read jsonl session catalog" && error.cause === catalogFailure,
  );
});

test("catalog and constructed-dependency contracts fail before a candidate is usable", async () => {
  await assert.rejects(
    async () => await validateCatalogAccess(catalog({ backend: "sqlite" }), { backend: "jsonl" }),
    /catalog backend mismatch/,
  );
  await assert.rejects(
    async () => await validateCatalogAccess(catalog({ tree: undefined }), { backend: "jsonl" }),
    /catalog is missing tree\(\)/,
  );
  await assert.rejects(
    async () => await validateCatalogAccess(catalog({ list: () => ({}) }), { backend: "jsonl" }),
    /list\(\) must return an array/,
  );

  assert.doesNotThrow(() => validateDependencyConstruction({ codec: {
    value: { validate() {}, serialize() {} }, methods: ["validate", "serialize"],
  } }));
  assert.throws(
    () => validateDependencyConstruction({ codec: { value: {}, methods: ["validate"] } }),
    /dependency "codec" is missing validate\(\)/,
  );
  assert.throws(() => validateDependencyConstruction(null), /dependencies must be an object/);
  assert.throws(
    () => validateDependencyConstruction({ codec: { value: {}, methods: "validate" } }),
    /methods must be an array/,
  );
});

test("application completes preflight and route-table validation before process-facing scheduling", () => {
  const source = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");
  const repositories = source.indexOf("validateRepositoryAvailability(appStore)");
  const catalogAccess = source.indexOf("validateCatalogAccess(state.sessionCatalog");
  const dependencies = source.indexOf("validateDependencyConstruction({");
  const routes = source.indexOf("const routeTable = createRouteTable({");
  const scheduling = source.indexOf("scheduleHublotStartupReconciliation({ state");

  assert.ok(repositories > 0);
  assert.ok(repositories < catalogAccess && catalogAccess < dependencies && dependencies < routes && routes < scheduling);
});
