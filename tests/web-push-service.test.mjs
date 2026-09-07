import test from "node:test";
import assert from "node:assert/strict";
import { createWebPushService } from "../server/web-push-service.mjs";

function fixture({ sendNotification = async () => ({}) } = {}) {
  let keys = null;
  const subscriptions = [{ endpoint: "https://push.example/sub", expiration_time: null, p256dh: "key", auth: "auth" }];
  const delivered = [];
  const deleted = [];
  const repository = {
    getVapidKeys: async () => keys,
    createVapidKeys: async (value) => (keys = { publicKey: value.publicKey, privateKey: value.privateKey }),
    listSubscriptions: async () => subscriptions,
    markDelivered: async (...args) => delivered.push(args),
    deleteSubscription: async (endpoint) => deleted.push(endpoint),
    upsertSubscription: async () => {},
  };
  const push = {
    generateVAPIDKeys: () => ({ publicKey: "public", privateKey: "private" }),
    setVapidDetails() {},
    sendNotification,
  };
  return { repository, push, delivered, deleted };
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

test("web push identifies the session and workdir for clarification and completion", async () => {
  const payloads = [];
  const state = fixture({ sendNotification: async (_subscription, payload) => payloads.push(JSON.parse(payload)) });
  let clock = 1_000;
  const service = await createWebPushService({ ...state, now: () => clock, longRunMs: 60_000 });
  const runner = { id: "runner-1", sessionId: "session 1", sessionName: "Improve notifications", dir: "/home/ubuntu/oyster" };

  service.handleRunnerEvent(runner, { type: "extension_ui_request", id: "question-1", method: "input", title: "SECRET PROMPT" });
  service.handleRunnerEvent(runner, { type: "agent_start" });
  clock += 59_999;
  service.handleRunnerEvent(runner, { type: "agent_settled" });
  service.handleRunnerEvent(runner, { type: "agent_start" });
  clock += 60_000;
  service.handleRunnerEvent(runner, { type: "agent_settled" });
  await drain();

  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads.map(({ title, url }) => ({ title, url })), [
    { title: "Oyster needs your input", url: "/s/session%201" },
    { title: "Oyster task finished", url: "/s/session%201" },
  ]);
  assert.doesNotMatch(JSON.stringify(payloads), /SECRET PROMPT/);
  assert.deepEqual(payloads.map(({ body }) => body), [
    "Improve notifications\n/home/ubuntu/oyster",
    "Improve notifications\n/home/ubuntu/oyster",
  ]);
  assert.equal(state.delivered.length, 2);
});

test("web push shortens long identity fields without splitting emoji and handles unnamed sessions", async () => {
  const payloads = [];
  const state = fixture({ sendNotification: async (_subscription, payload) => payloads.push(JSON.parse(payload)) });
  const service = await createWebPushService(state);
  const notify = (runner) => service.handleRunnerEvent(runner, { type: "extension_ui_request", method: "input", id: "question" });
  notify({ id: "long", sessionName: "👩‍💻".repeat(61), dir: `/${"parent/".repeat(20)}oyster` });
  notify({ id: "unnamed", sessionName: "  ", dir: "/work/project" });
  notify({ id: "missing" });
  notify({ id: "whitespace", sessionName: "  Fix\n mobile\t alerts  ", dir: "/work/project" });
  await drain();
  const [name, workdir] = payloads[0].body.split("\n");
  assert.equal(name, `${"👩‍💻".repeat(59)}…`);
  assert.equal(workdir.length, 100);
  assert.ok(workdir.startsWith("…"));
  assert.ok(workdir.endsWith("/oyster"));
  assert.equal(payloads[1].body, "Untitled session\n/work/project");
  assert.equal(payloads[2].body, "Untitled session");
  assert.equal(payloads[2].url, "/");
  assert.equal(payloads[3].body, "Fix mobile alerts\n/work/project");
});

test("web push ignores fire-and-forget extension UI events and removes expired endpoints", async () => {
  const error = Object.assign(new Error("gone"), { statusCode: 410 });
  const state = fixture({ sendNotification: async () => { throw error; } });
  const service = await createWebPushService({ ...state, now: () => 1 });
  const runner = { id: "runner-1", sessionId: "session" };
  service.handleRunnerEvent(runner, { type: "extension_ui_request", id: "status", method: "notify" });
  service.handleRunnerEvent(runner, { type: "extension_ui_request", id: "question", method: "confirm" });
  await drain();
  assert.deepEqual(state.deleted, ["https://push.example/sub"]);
});
