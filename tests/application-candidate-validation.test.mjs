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

test("repository preflight requires every application boundary and probes the stable connection", () => {
  let hydrated = 0;
  const store = appStore({
    hydrate() { hydrated += 1; return { incompleteOperations: [] }; },
  });
  assert.deepEqual(validateRepositoryAvailability(store), { incompleteOperations: [] });
  assert.equal(hydrated, 1);

  delete store.repositories.pinnedWidgets;
  assert.throws(
    () => validateRepositoryAvailability(store),
    /repository "pinnedWidgets" is unavailable \(missing list\(\)\)/,
  );
  assert.equal(hydrated, 1, "an incomplete registry must fail before database access");
});

test("repository and catalog access failures retain their original causes", () => {
  const databaseFailure = new Error("database is closed");
  assert.throws(
    () => validateRepositoryAvailability(appStore({ hydrate() { throw databaseFailure; } })),
    (error) => error.message === "application repository access failed" && error.cause === databaseFailure,
  );

  const catalogFailure = new Error("malformed session schema");
  assert.throws(
    () => validateCatalogAccess(catalog({ list() { throw catalogFailure; } }), { backend: "jsonl", cwd: "/workspace" }),
    (error) => error.message === "cannot read jsonl session catalog" && error.cause === catalogFailure,
  );
});

test("catalog and constructed-dependency contracts fail before a candidate is usable", () => {
  assert.throws(
    () => validateCatalogAccess(catalog({ backend: "sqlite" }), { backend: "jsonl" }),
    /catalog backend mismatch/,
  );
  assert.throws(
    () => validateCatalogAccess(catalog({ tree: undefined }), { backend: "jsonl" }),
    /catalog is missing tree\(\)/,
  );
  assert.throws(
    () => validateCatalogAccess(catalog({ list: () => ({}) }), { backend: "jsonl" }),
    /list\(\) must return an array/,
  );

  assert.doesNotThrow(() => validateDependencyConstruction({ codec: {
    value: { validate() {}, serialize() {} }, methods: ["validate", "serialize"],
  } }));
  assert.throws(
    () => validateDependencyConstruction({ codec: { value: {}, methods: ["validate"] } }),
    /dependency "codec" is missing validate\(\)/,
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
