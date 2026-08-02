import test from "node:test";
import assert from "node:assert/strict";
import { createRouteTable } from "../server/http/createRouteTable.mjs";

test("createRouteTable merges named groups in group and route order", () => {
  const health = () => "healthy";
  const list = () => "sessions";
  const remove = () => "removed";

  const table = createRouteTable({
    open: { "GET /health": health },
    sessions: new Map([
      ["GET /sessions", list],
      ["DELETE /sessions", remove],
    ]),
  });

  assert.deepEqual([...table.keys()], ["GET /health", "GET /sessions", "DELETE /sessions"]);
  assert.equal(table.get("GET /health"), health);
  assert.equal(table.get("GET /sessions"), list);
  assert.equal(table.get("POST /sessions"), undefined);
});

test("createRouteTable rejects duplicate method/path keys instead of shadowing", () => {
  assert.throws(
    () => createRouteTable({
      first: { "GET /health": () => "first" },
      second: { "GET /health": () => "second" },
    }),
    /duplicate route "GET \/health".*"first".*"second"/,
  );
});

test("createRouteTable validates route keys and handlers during construction", () => {
  assert.throws(() => createRouteTable({ open: { "/health": () => {} } }), /invalid route key/);
  assert.throws(() => createRouteTable({ open: { "GET /health": null } }), /must be a function/);
  assert.throws(() => createRouteTable({ open: [] }), /must be a plain object or Map/);
});

test("createRouteTable rejects non-string Map keys without coercing them", () => {
  const key = Object.create(null);
  assert.throws(
    () => createRouteTable({ open: new Map([[key, () => {}]]) }),
    /route key in group "open" must be a string/,
  );
  assert.throws(
    () => createRouteTable({ open: new Map([[Symbol("GET /health"), () => {}]]) }),
    /route key in group "open" must be a string/,
  );
});

test("createRouteTable rejects keys that request URL parsing makes unreachable", () => {
  for (const key of ["GET /health?ready", "GET /health#status", "GET /health\\check", "GET /health\0check"]) {
    assert.throws(
      () => createRouteTable({ open: new Map([[key, () => {}]]) }),
      /invalid route key/,
      key,
    );
  }
});

test("createRouteTable requires plain named records but supports null-prototype records", () => {
  for (const groups of [null, [], new Map(), new Date(), () => {}]) {
    assert.throws(() => createRouteTable(groups), /route groups must be a named plain object/);
  }
  assert.throws(
    () => createRouteTable({ open: new Date() }),
    /route group "open" must be a plain object or Map/,
  );

  const handler = () => {};
  const routes = Object.assign(Object.create(null), { "GET /health": handler });
  const groups = Object.assign(Object.create(null), { open: routes });
  assert.equal(createRouteTable(groups).get("GET /health"), handler);
});
