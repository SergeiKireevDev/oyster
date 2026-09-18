import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnRoutineAgent } from "../server/routine-generation.mjs";
import { spawnRoutineAgent as publicFacade } from "../server/routines.mjs";

function fixture(t, runners = new Map()) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill: t.mock.fn(), unref: t.mock.fn(),
  });
  const state = { runners, currentDir: "/fallback", piProcesses: { ephemeral: t.mock.fn(() => proc) } };
  return { state, proc };
}

test("routine facade preserves the extracted generator export", () => {
  assert.equal(publicFacade, spawnRoutineAgent);
});

test("generator validates input before spawning", (t) => {
  const { state } = fixture(t);
  assert.throws(() => spawnRoutineAgent(state, { brief: " ", sessionId: "s" }), /describe the routine/);
  assert.throws(() => spawnRoutineAgent(state, { brief: "job" }), /current session/);
  assert.equal(state.piProcesses.ephemeral.mock.callCount(), 0);
});

test("generator uses injected launcher, explicit session, runner cwd and bounded merged output", async (t) => {
  const { state, proc } = fixture(t, new Map([["runner", { sessionId: "s", dir: "/session" }]]));
  const pending = spawnRoutineAgent(state, { brief: " build job ", sessionId: "s" });
  const [args, options] = state.piProcesses.ephemeral.mock.calls[0].arguments;
  assert.deepEqual(args.slice(0, 2), ["--no-session", "-p"]);
  assert.match(args[2], /Target session_id: s/);
  assert.match(args[2], /User request: build job$/);
  assert.match(args[2], /Do not merely write a file and do not start the routine/);
  assert.deepEqual(options, { cwd: "/session", stdio: ["ignore", "pipe", "pipe"], detached: true });
  proc.stdout.emit("data", "x".repeat(4000));
  proc.stderr.emit("data", "done");
  proc.emit("exit", 0, null);
  const result = await pending;
  assert.equal(result.output.length, 3000);
  assert.ok(result.output.endsWith("done"));
  assert.equal(proc.unref.mock.callCount(), 1);
  t.mock.timers.tick(400000);
  assert.equal(proc.kill.mock.callCount(), 0);
});

test("generator uses fallback cwd and reports exit failure's last line", async (t) => {
  const { state, proc } = fixture(t);
  const pending = spawnRoutineAgent(state, { brief: "job", sessionId: "s" });
  assert.equal(state.piProcesses.ephemeral.mock.calls[0].arguments[1].cwd, "/fallback");
  const failure = assert.rejects(pending, /routine agent exited \(2\): final error/);
  proc.stderr.emit("data", "previous\nfinal error\n");
  proc.emit("exit", 2, null);
  await failure;
  t.mock.timers.tick(400000);
  assert.equal(proc.kill.mock.callCount(), 0);
});

test("generator handles synchronous launcher and asynchronous spawn errors", async (t) => {
  const { state, proc } = fixture(t);
  const pending = spawnRoutineAgent(state, { brief: "job", sessionId: "s" });
  const failure = assert.rejects(pending, /failed to spawn routine agent: unavailable/);
  proc.emit("error", new Error("unavailable"));
  await failure;
  t.mock.timers.tick(400000);
  assert.equal(proc.kill.mock.callCount(), 0);
  state.piProcesses.ephemeral = () => { throw new Error("sync spawn failure"); };
  await assert.rejects(spawnRoutineAgent(state, { brief: "job", sessionId: "s" }), /sync spawn failure/);
});

test("timeout terminates then force-kills an unresponsive routine agent", async (t) => {
  const { state, proc } = fixture(t);
  const pending = spawnRoutineAgent(state, { brief: "job", sessionId: "s" });
  const failure = assert.rejects(pending, /timed out while the routine agent was working/);
  t.mock.timers.tick(300000);
  await failure;
  assert.deepEqual(proc.kill.mock.calls.map(call => call.arguments), [["SIGTERM"]]);
  t.mock.timers.tick(4000);
  assert.deepEqual(proc.kill.mock.calls.map(call => call.arguments), [["SIGTERM"], ["SIGKILL"]]);
});

test("exit after termination cancels the pending force-kill timer", async (t) => {
  const { state, proc } = fixture(t);
  const pending = spawnRoutineAgent(state, { brief: "job", sessionId: "s" });
  const failure = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(300000);
  await failure;
  proc.emit("exit", null, "SIGTERM");
  t.mock.timers.tick(4000);
  assert.equal(proc.kill.mock.callCount(), 1);
});
