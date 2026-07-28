import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import {
  listTunnels, openTunnel, publicHublotAnswers, reserveHublot, waitForPublicHublot,
} from "../server/tunnels.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-hublot-public-ready-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const events = [];
  const state = {
    appStore: store,
    config: { PI_AGENT_DIR: join(root, "agent"), TUNNEL_BIN: "cloudflared" },
    currentDir: root,
    serverEvent: (event) => events.push(event),
  };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, state, events };
}

class FakeTunnelProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = process.pid;
    this.exitCode = null;
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }

  kill() { this.killed = true; }
}

test("a hublot stays opening and unpublished until its public health check passes", async (t) => {
  const { store, state, events } = fixture(t);
  const reserved = reserveHublot(state, { port: 4188, brief: "serve preview" });
  const proc = new FakeTunnelProcess();
  let releaseHealth;
  let reportHealthStarted;
  const healthStarted = new Promise((resolve) => { reportHealthStarted = resolve; });
  const healthGate = new Promise((resolve) => { releaseHealth = resolve; });

  const opening = openTunnel(state, {
    id: reserved.id,
    port: reserved.port,
    label: "preview",
  }, {
    spawnProcess: () => proc,
    waitForPublic: async (url) => {
      assert.equal(url, "https://waiting.trycloudflare.com");
      reportHealthStarted();
      await healthGate;
    },
  });
  proc.stderr.emit("data", "URL https://waiting.trycloudflare.com assigned");
  await healthStarted;

  assert.equal(store.repositories.hublots.find(reserved.id).status, "opening");
  assert.equal(store.repositories.hublots.find(reserved.id).public_url, null);
  const [pending] = listTunnels(state);
  assert.equal(pending.id, reserved.id);
  assert.equal(pending.status, "opening");
  assert.equal(pending.url, null);
  assert.deepEqual(events, []);

  releaseHealth();
  const opened = await opening;
  assert.equal(opened.url, "https://waiting.trycloudflare.com");
  assert.equal(store.repositories.hublots.find(reserved.id).status, "open");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tunnel_opened");
});

test("public readiness polling retries transient failures and times out clearly", async () => {
  let now = 0;
  let checks = 0;
  await waitForPublicHublot("https://eventual.test", {
    timeoutMs: 100,
    intervalMs: 10,
    check: async () => ++checks === 3,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(checks, 3);

  now = 0;
  await assert.rejects(
    waitForPublicHublot("https://never.test", {
      timeoutMs: 25,
      intervalMs: 10,
      check: async () => false,
      clock: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    /public hublot did not become ready within 0\.025s/,
  );
});

test("public health checks accept successful origin responses and reject Cloudflare errors", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { status: requests.length === 1 ? 502 : 200, body: { async cancel() {} } };
  };

  assert.equal(await publicHublotAnswers("https://health.test", { fetchImpl }), false);
  assert.equal(await publicHublotAnswers("https://health.test", { fetchImpl }), true);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.redirect, "manual");
  assert.match(requests[0].url.search, /__oyster_hublot_health=/);
});
