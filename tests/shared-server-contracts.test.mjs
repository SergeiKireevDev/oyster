import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFunction, requireFunction, requireNonBlankString, requireTrimmedNonEmptyString } from "../server/validation.mjs";
import { errorMessage } from "../server/errors.mjs";
import { logError } from "../server/logging.mjs";
import { isNonArrayObject, objectBody } from "../server/valuePredicates.mjs";
import { isWithin } from "../server/http/pathContainment.mjs";
import { createRequestContext, disableCaching } from "../server/http/createRequestContext.mjs";
import { nonNegativeUsageNumber } from "../server/runner-drivers/usageValues.mjs";
import { signalProcessGroup, STOP_GRACE_MS } from "../server/process-groups.mjs";

// Contract tests deliberately distinguish policies that looked similar to the scanner.
test("callback assertions preserve both returning and assertion-only contracts", () => {
  const fn = () => {};
  assert.equal(requireFunction(fn, "callback"), fn);
  assert.equal(assertFunction(fn, "callback"), undefined);
  for (const value of [null, undefined, {}, [], "fn", 1]) {
    for (const check of [requireFunction, assertFunction]) {
      assert.throws(() => check(value, "callback"), { name: "TypeError", message: "callback must be a function" });
    }
  }
});

test("string validators differ only in whether the result is trimmed", () => {
  for (const value of ["value", " padded path ", "\tkey\n"]) {
    assert.equal(requireNonBlankString(value, "path"), value);
    assert.equal(requireTrimmedNonEmptyString(value, "path"), value.trim());
  }
  for (const value of ["", " \t\n", null, undefined, 0, {}, new String("text")]) {
    for (const check of [requireNonBlankString, requireTrimmedNonEmptyString]) {
      assert.throws(() => check(value, "path"), { name: "TypeError", message: "path must be a non-empty string" });
    }
  }
});

test("object predicate excludes arrays but deliberately admits non-plain objects", () => {
  for (const value of [{}, Object.create(null), new Date(), new (class Record {})()]) {
    assert.equal(isNonArrayObject(value), true);
    assert.equal(objectBody(value), true);
  }
  for (const value of [null, undefined, false, 0, NaN, "", [], "text", 1, () => {}]) {
    assert.equal(isNonArrayObject(value), false);
    assert.equal(objectBody(value), value ? false : value);
  }
});

test("error formatting retains String conversion and does not claim to sanitize", () => {
  assert.equal(errorMessage(new Error("broken")), "broken");
  assert.equal(errorMessage(new Error("")), "");
  for (const value of [null, undefined, 12, "text", { toString: () => "custom" }]) {
    assert.equal(errorMessage(value), String(value));
  }
  assert.throws(() => errorMessage({ toString() { throw new Error("coercion"); } }), /coercion/);
});

test("best-effort logging preserves logger receiver and suppresses logger errors", () => {
  const logger = { messages: [], error(message) { this.messages.push(message); } };
  assert.equal(logError(logger, "failure"), undefined);
  assert.deepEqual(logger.messages, ["failure"]);
  assert.doesNotThrow(() => logError({ error() { throw new Error("logger failed"); } }, "failure"));
  assert.doesNotThrow(() => logError(null, "failure"));
});

test("usage coercion is not integer validation or strict analytics normalization", () => {
  for (const [value, expected] of [["12.5", 12.5], [2.5, 2.5], [true, 1], [null, 0], ["", 0], [-1, 0], [Infinity, 0], [NaN, 0], ["no", 0]]) {
    assert.equal(nonNegativeUsageNumber(value), expected);
  }
  assert.throws(() => nonNegativeUsageNumber(Symbol("usage")), TypeError);
});

test("no-store is opt-in and works with lightweight response mocks", () => {
  const calls = [];
  const res = { setHeader(...args) { assert.equal(this, res); calls.push(args); } };
  disableCaching(res);
  assert.deepEqual(calls, [["cache-control", "no-store"]]);
  assert.doesNotThrow(() => disableCaching({}));
  const context = createRequestContext({ config: { TOKEN: "test", DIRNAME: "/tmp", PI_DIR: "/tmp" } });
  assert.equal(context.disableCaching, disableCaching);
  const headers = [];
  context.json({ writeHead(...args) { headers.push(args); }, end() {} }, 200, {});
  assert.equal(headers[0][1]["cache-control"], undefined);
});

test("lexical containment preserves sibling, traversal and dot-prefix behavior", () => {
  const root = join(tmpdir(), "oyster-paths");
  for (const path of [root, join(root, "child"), join(root, "..cache")]) assert.equal(isWithin(path, root), true);
  for (const path of [join(root, ".."), `${root}-other`, join(root, "..", "escape")]) assert.equal(isWithin(path, root), false);
});

test("lexical containment does not replace canonical-path authorization", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-containment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "safe"));
  const config = { TOKEN: "test", DIRNAME: root, PI_DIR: join(root, "safe") };
  symlinkSync(join(root, ".ui-token"), join(root, "safe", "link"));
  assert.equal(isWithin(join(root, "safe", "link"), join(root, "safe")), true);
  // A real denied file is needed for realpath to resolve the symlink.
  mkdirSync(join(root, ".ui-token"));
  assert.equal(createRequestContext({ config }).resolveSafePath(join(root, "safe", "link")), null);
});

test("process-group signaling falls back to child.kill without throwing", (t) => {
  assert.equal(STOP_GRACE_MS, 4000);
  const group = t.mock.method(process, "kill", () => {});
  const child = { pid: 12345, kill: t.mock.fn() };
  signalProcessGroup(child, "SIGTERM");
  assert.deepEqual(group.mock.calls[0].arguments, [-12345, "SIGTERM"]);
  assert.equal(child.kill.mock.callCount(), 0);
  group.mock.mockImplementation(() => { throw new Error("no group"); });
  signalProcessGroup(child, "SIGKILL");
  assert.deepEqual(child.kill.mock.calls[0].arguments, ["SIGKILL"]);
  assert.doesNotThrow(() => signalProcessGroup(null, "SIGTERM"));
  assert.doesNotThrow(() => signalProcessGroup({ kill() { throw new Error("gone"); } }, "SIGTERM"));
});
