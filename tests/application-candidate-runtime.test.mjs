import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCandidateState, createDisposableScope, createRequestLifecycle } from "../server/application-candidate.mjs";

const appSource = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");

test("candidate-owned state is staged without replacing or reading active generation resources", () => {
  const activeCatalog = { close() { throw new Error("active catalog must remain open"); } };
  const activeWatchdog = { generation: "active" };
  const stable = {
    currentDir: "/before",
    sessionCatalog: activeCatalog,
    runnerWatchdogTimer: activeWatchdog,
  };
  const candidate = createCandidateState(stable);

  assert.equal(candidate.sessionCatalog, undefined);
  assert.equal(candidate.runnerWatchdogTimer, undefined);
  candidate.sessionCatalog = { generation: "candidate" };
  candidate.runnerWatchdogTimer = { generation: "candidate" };
  candidate.currentDir = "/after";

  assert.equal(stable.sessionCatalog, activeCatalog);
  assert.equal(stable.runnerWatchdogTimer, activeWatchdog);
  assert.equal(stable.currentDir, "/after", "stable fields continue to use stable-core ownership");
});

test("candidate disposable scope cleans staged resources once in reverse acquisition order", async () => {
  const calls = [];
  const scope = createDisposableScope();
  scope.defer(() => calls.push("catalog"));
  scope.defer(async () => calls.push("timers"));
  scope.defer(() => calls.push("oauth"));

  const first = scope.dispose();
  const second = scope.dispose();
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls, ["oauth", "timers", "catalog"]);
  await scope.dispose();
  assert.deepEqual(calls, ["oauth", "timers", "catalog"]);
});

test("candidate generation guards suppress queued timers and listeners after disposal", async () => {
  const calls = [];
  const listeners = new Map();
  const target = {
    addEventListener(event, callback) { listeners.set(event, callback); },
    removeEventListener(event, callback) {
      if (listeners.get(event) === callback) listeners.delete(event);
    },
  };
  const scope = createDisposableScope({ generation: 41 });
  const timerCallback = scope.guard(() => calls.push("timer"));
  const listenerCallback = scope.listen(target, "change", () => calls.push("listener"));

  assert.equal(timerCallback.generation, 41);
  assert.equal(listenerCallback.generation, 41);
  timerCallback();
  listeners.get("change")();
  assert.deepEqual(calls, ["timer", "listener"]);

  const queuedListener = listeners.get("change");
  await scope.dispose();
  assert.equal(scope.active, false);
  assert.equal(listeners.size, 0);
  timerCallback();
  queuedListener();
  assert.deepEqual(calls, ["timer", "listener"], "callbacks queued by a retired generation are inert");
});

test("candidate disposable scope retries only cleanups that previously failed", async () => {
  const calls = [];
  let transientAttempts = 0;
  const scope = createDisposableScope();
  scope.defer(() => calls.push("already-clean"));
  scope.defer(() => {
    calls.push("transient");
    if (++transientAttempts === 1) throw new Error("busy");
  });

  await assert.rejects(scope.dispose(), /candidate disposal failed/);
  await scope.dispose();
  assert.deepEqual(calls, ["transient", "already-clean", "transient"]);
});

test("candidate retirement drains admitted requests before resource cleanup", async () => {
  const lifecycle = createRequestLifecycle();
  let release;
  const request = lifecycle.handle(() => new Promise((resolve) => { release = resolve; }), []);

  let retired = false;
  const retirement = lifecycle.retire().then(() => { retired = true; });
  await Promise.resolve();
  assert.equal(retired, false);
  assert.throws(() => lifecycle.handle(() => Promise.resolve(), []), /retired/);

  release("done");
  assert.equal(await request, "done");
  await retirement;
  assert.equal(retired, true);
});

test("application construction defers candidate resource acquisition until activation", () => {
  const activation = appSource.indexOf("async function activate()");
  assert.ok(activation > appSource.indexOf("export async function buildCandidate"));
  for (const acquisition of [
    "createSqliteSessionCatalog",
    "createPiProcessLauncher({ config })",
    "createRunnerManager(state",
    "scheduleHublotStartupReconciliation({ state",
  ]) {
    assert.ok(appSource.indexOf(acquisition) > activation, `${acquisition} must be activation-only`);
  }
  assert.doesNotMatch(appSource, /state\.sessionCatalog\?\.close/);
  assert.match(appSource, /scope\.defer\(\(\) => candidateCatalog\.close/);
  assert.match(appSource, /scope\.defer\(\(\) => \{ clearInterval\(reaperTimer\); clearInterval\(watchdogTimer\); \}\)/);
  assert.match(appSource, /createRunnerManager\(state, \{ appStore, ensureSessionOwner, guardCallback: scope\.guard \}\)/);
  assert.match(appSource, /setTimer: \(callback, delay\) => setTimeout\(scope\.guard\(callback\), delay\)/);
});
