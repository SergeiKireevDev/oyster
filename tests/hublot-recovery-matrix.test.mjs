import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

/** Keep the complete cross-process hublot recovery contract represented in the test suite. */
test("hublot recovery validation matrix covers restart, crash, identity, orphan, URL, and self-served cases", () => {
  const shutdown = source("./hublot-shutdown.test.mjs");
  const supervisor = source("./hublot-supervisor.test.mjs");
  const identity = source("./hublot-process-identity.test.mjs");
  const recovery = source("./hublot-service-restart.test.mjs");

  assert.match(shutdown, /graceful hublot shutdown awaits bounded escalation and retains desired-open recovery state/);
  assert.match(supervisor, /startup reconciliation includes every persisted desired-open state/);
  assert.match(supervisor, /stale-tunnel/);
  assert.match(supervisor, /status, "lost"/);
  assert.match(supervisor, /identity verification rejects PID-only, restarted, and fingerprint-mismatched processes/);
  assert.match(identity, /process identity captures PID-reuse-resistant Linux metadata/);
  assert.match(recovery, /answering service receives a replacement tunnel identity and durable URL/);
  assert.match(recovery, /https:\/\/new-url\.test/);
  assert.match(recovery, /missing self-served services without startup scripts become actionable interruptions/);
});

test("production hublot cleanup gates signaling and publication on full persisted identity", () => {
  const tunnels = source("../tunnels.mjs");
  const supervisor = source("../persistence/hublotSupervisor.mjs");
  assert.match(tunnels, /if \(!verifyIdentity\(processRow\)\) continue;\s+targets\.push\(processRow\)/);
  assert.match(tunnels, /const live = \(\) => targets\.filter\(\(processRow\) => verifyIdentity\(processRow\)\)/);
  assert.match(tunnels, /currentHublotTunnelProcessIsHealthy/);
  assert.match(supervisor, /matches: verifyIdentity\(process\)/);
  assert.match(supervisor, /status: "lost"/);
});
