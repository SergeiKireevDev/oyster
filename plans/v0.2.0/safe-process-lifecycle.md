# Safe Process Lifecycle and Ownership

## Goal

Replace fire-and-forget process signaling with one awaited, identity-aware
lifecycle boundary. Stopping or replacing a runner, hublot process, routine,
title helper, or ephemeral pi process must prove the old process exited before
a replacement can claim its state.

The plan addresses ineffective checks based on `ChildProcess.killed`, delayed
signals that can target reused PIDs, and stale exit callbacks that can mutate a
new runner generation.

## Guardrails

- `child.killed` means Node successfully sent a signal; it does not prove the
  process exited. Liveness is determined by `exitCode`, `signalCode`, an
  observed `exit`/`close`, or verified operating-system identity.
- Verify persisted process identity immediately before **every** signal,
  including delayed SIGKILL. A verification performed before a timer starts is
  stale when the timer fires.
- Await SIGTERM, bounded escalation, and final exit before starting a
  replacement. Report a failure if the process remains alive after SIGKILL.
- Preserve process-group termination for routine scripts and descendants.
- Preserve runner IDs, desired-state persistence, RPC replay behavior, and SSE
  event ordering.
- Old process callbacks may finalize only their own generation. They must not
  clear readers, busy state, timers, or repository status owned by a newer
  process.
- Keep long-lived process handles and generation counters in stable state, not
  module-global reloadable code.

## 1. Characterize Current Termination Races

- [ ] Add deterministic child fixtures that ignore SIGTERM, exit after SIGTERM,
  spawn descendants, and expose a controllable delayed exit.
- [ ] Add regression tests proving the current `!proc.killed` escalation check
  fails to send SIGKILL after SIGTERM and proving replacement can begin before
  exit.
- [ ] Add runner-generation tests where an old process exits after a replacement
  starts; assert the old callback cannot clear the replacement reader or mark
  the runner dead.
- [ ] Add persisted-PID tests that simulate PID reuse between SIGTERM and the
  escalation timer.

**Acceptance:** tests reproduce each race without wall-clock sleeps by using
injected clocks, signal functions, and process-identity readers.

## 2. Introduce One Awaited Termination Primitive

- [ ] Add a narrow process-lifecycle module with adapters for a `ChildProcess`,
  a persisted process record, and a process group. The primitive must return a
  structured result containing observed exit, signals sent, escalation,
  timeout, and final identity state.
- [ ] Send SIGTERM once, await `exit`/`close` up to a configured deadline, send
  SIGKILL only when the same process is still alive, and await a second bounded
  deadline.
- [ ] Handle already-exited processes, spawn errors, ESRCH, duplicate stop
  calls, and concurrent stop callers idempotently. Remove listeners and timers
  on every completion path.
- [ ] For persisted records, call `verifyPersistedProcessIdentity()` immediately
  before SIGTERM and again immediately before SIGKILL. Treat an identity
  mismatch as “ownership lost,” never as permission to signal.

**Acceptance:** focused tests cover graceful exit, forced exit, timeout,
identity loss, PID reuse, process groups, and duplicate callers with no leaked
timers or listeners.

## 3. Make Runner Stop and Restart Generation-Safe

- [ ] Give each runner process start a monotonically increasing generation and
  bind stdout readers, resume timers, exit callbacks, and busy state updates to
  that generation.
- [ ] Make `stopRunner()` asynchronous. Persist `desired_state=stopped`, reject
  or queue sends, terminate the captured generation, then publish the final
  stopped event only after exit is observed.
- [ ] Make explicit restart, credential-triggered restart, watchdog restart,
  workdir switching, and session deletion await the same stop promise before
  spawning a replacement.
- [ ] Define concurrent start/stop/restart coalescing so only one process can own
  a runner generation and the final requested desired state wins.
- [ ] Preserve the old process's real exit code and signal in diagnostics rather
  than synthesizing an exit before it occurs.

**Acceptance:** stress tests interleave stop, restart, watchdog timeout, and
send operations while proving at most one live pi child exists for a runner.

## 4. Make Hublot Shutdown Identity-Safe

- [ ] Replace `closeTunnel()` direct PID signaling and delayed `killPid()` calls
  with the shared termination primitive.
- [ ] Verify every tracked service, setup agent, and tunnel process against its
  persisted start time and executable identity before signaling it. Continue to
  protect unrelated listeners discovered on the same port.
- [ ] Record “ownership lost,” “graceful,” “forced,” and “still alive” outcomes
  in hublot process metadata before finalizing the hublot transition.
- [ ] Reuse the same implementation for one-hublot close, session deletion,
  server shutdown, startup reconciliation, and failed-open cleanup.
- [ ] Do not mark a hublot closed while any verified owned process remains
  alive; retain an actionable interrupted state for reconciliation.

**Acceptance:** tests simulate PID reuse and stubborn service/tunnel processes;
no unrelated PID receives either signal, and durable status matches reality.

## 5. Converge Routine and Helper Lifecycles

- [ ] Route routine run/teardown process-group termination through the shared
  primitive while preserving monotonic progress and descendant cleanup.
- [ ] Route title generation, checkpoint summary agents, hublot preparation
  agents, and other one-shot pi children through bounded termination adapters.
- [ ] Inventory every `kill()`, `process.kill()`, SIGTERM timer, and SIGKILL timer
  under `server/`; either migrate it or document why it is safe and tested.
- [ ] Add a static guard that rejects new ad hoc TERM-then-timeout-KILL sequences
  outside the lifecycle module.

**Acceptance:** process termination policy has one implementation and one test
matrix; remaining direct signals are narrow, documented exceptions.

## 6. Add Operational Visibility and Complete Validation

- [ ] Add non-secret counters for graceful stops, forced stops, identity
  mismatches, timeouts, and concurrent-stop coalescing. Expose details only in
  authenticated diagnostics.
- [ ] Verify shutdown remains bounded and leaves no owned process groups after
  service restart or container stop.
- [ ] Run the complete build, unit, Docker, and e2e matrix, including session
  stop/restart, credential restart, routine teardown, hublot close, and server
  replacement scenarios.

## Completion criteria

- SIGKILL escalation is based on observed liveness, never `child.killed`.
- A replacement process never starts before the previous owned generation exits
  or the operation reports a hard failure.
- Every persisted PID is identity-verified immediately before every signal.
- Stale callbacks cannot mutate a newer process generation.
- Runner, hublot, routine, helper, shutdown, and reconciliation paths share the
  same bounded and observable lifecycle semantics.
