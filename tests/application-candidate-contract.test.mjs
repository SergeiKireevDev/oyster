import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const specification = readFileSync(
  new URL("../docs/development/hot-reload-lifecycle.md", import.meta.url),
  "utf8",
);

function section(heading, nextHeading) {
  const start = specification.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing ${heading} section`);
  const end = nextHeading ? specification.indexOf(`## ${nextHeading}`, start + 1) : specification.length;
  assert.notEqual(end, -1, `missing ${nextHeading} section`);
  return specification.slice(start, end);
}

test("candidate contract defines side-effect-free construction and explicit phases", () => {
  const contract = section("Candidate application contract", "Failure and concurrency semantics");

  assert.match(contract, /buildCandidate\(stableDependencies\)/);
  for (const method of ["activate", "handleRequest", "dispose"]) {
    assert.match(contract, new RegExp(`\\b${method}\\b`), `missing candidate method ${method}`);
  }
  const normalizedContract = contract.replace(/\s+/g, " ");
  for (const forbiddenConstructionEffect of [
    "write or delete stable-state fields",
    "write repositories",
    "start or signal a process",
    "open a catalog handle",
    "install an event listener",
    "schedule a timer",
  ]) {
    assert.ok(normalizedContract.includes(forbiddenConstructionEffect), `construction must forbid: ${forbiddenConstructionEffect}`);
  }

  assert.match(normalizedContract, /dispose\(\).*asynchronous and idempotent/);
  assert.match(normalizedContract, /reverse acquisition order/);
  assert.match(normalizedContract, /waits for the candidate's already-entered request count to reach zero/);
  assert.match(normalizedContract, /Stable and shared-immutable dependencies are never closed/);
  assert.match(normalizedContract, /exactly one stable-core `activeApplication` reference/);
});

test("reload failures have an explicit commit point and phase outcome", () => {
  const semantics = section("Failure and concurrency semantics", "Resource owner and cleanup registry");
  const normalized = semantics.replace(/\s+/g, " ");

  assert.match(normalized, /one commit point:.*single, synchronous, non-throwing assignment to `activeApplication`/);
  for (const phase of ["Import", "Construction", "Activation", "Swap", "Old disposal"]) {
    assert.match(semantics, new RegExp(`\\| ${phase} \\|`), `missing failure phase ${phase}`);
  }
  for (const preSwapPhase of ["import", "construction", "activation", "swap"]) {
    assert.match(semantics, new RegExp(`phase: \\"${preSwapPhase}\\"[^|]*committed: false`), `${preSwapPhase} must be pre-swap`);
  }

  assert.match(normalized, /Once the reference changed, the new application is authoritative.*rollback is forbidden/);
  assert.match(normalized, /old application never rolls back to a partially retired generation/);
  assert.match(normalized, /`code_reload_cleanup_failed`.*`committed: true`/);
  assert.match(normalized, /retried a bounded number of times.*resource leak/);
  assert.match(normalized, /Do not retry until a later filesystem change/);
});

test("request admission remains generation-consistent across a swap", () => {
  const semantics = section("Failure and concurrency semantics", "Resource owner and cleanup registry");
  const normalized = semantics.replace(/\s+/g, " ");

  assert.match(normalized, /reads `activeApplication` once/);
  assert.match(normalized, /entered-request count synchronously, before the first `await`/);
  assert.match(normalized, /never migrated, replayed, or dispatched through a mixture/);
  assert.match(normalized, /old generation while new requests use the new generation/);
  assert.match(normalized, /decrements its entered-request count in `finally`, including on request abort and handler rejection/);
  assert.match(normalized, /does not retry the request, swap applications, or dispose either generation/);
});

test("resource registry assigns lifecycle resources one owner and cleanup path", () => {
  const registry = section("Resource owner and cleanup registry", "Direct stable-state mutations");
  const rows = registry.split("\n").filter((line) => line.startsWith("| ") && !line.includes("---") && !line.startsWith("| Resource"));

  for (const row of rows) {
    const columns = row.split("|").slice(1, -1).map((value) => value.trim());
    assert.equal(columns.length, 4, `registry row must have four columns: ${row}`);
    assert.ok(columns[1], `resource must have one owner: ${row}`);
    assert.ok(columns[3], `resource must have one cleanup path: ${row}`);
  }

  for (const resource of [
    "session catalog",
    "watchdog and reaper intervals",
    "HTTP request listeners",
    "SSE response",
    "Runner child",
    "Routine children",
    "Hublot service/tunnel children",
    "Hublot supervisor interval",
    "OAuth registry",
    "Application-store SQLite connection",
    "Listening HTTP socket",
    "Filesystem watcher and reload debounce timer",
    "Signal subscriptions",
  ]) {
    assert.ok(registry.includes(resource), `registry must cover ${resource}`);
  }
});
