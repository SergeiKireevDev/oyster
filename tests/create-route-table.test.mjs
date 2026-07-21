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
  assert.throws(() => createRouteTable({ open: [] }), /must be an object or Map/);
});
