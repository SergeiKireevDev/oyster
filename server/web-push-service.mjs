import webPush from "web-push";
const WORKDIR_NOTIFICATION_MAX_CHARS = 100;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
const SESSION_NAME_NOTIFICATION_MAX_CHARS = 60;


const CLARIFICATION_METHODS = new Set(["select", "confirm", "input", "editor"]);
export const DEFAULT_LONG_RUN_MS = 60_000;

function notificationUrl(runner) {
  return runner.sessionId ? `/s/${encodeURIComponent(runner.sessionId)}` : "/";
}

const notificationSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function compactNotificationText(value, limit, keepEnd = false) {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  const characters = Array.from(notificationSegmenter.segment(text), ({ segment }) => segment);
  if (characters.length <= limit) return text;
  return keepEnd ? `…${characters.slice(-(limit - 1)).join("")}` : `${characters.slice(0, limit - 1).join("")}…`;
}

function notificationBody(runner) {
  const name = compactNotificationText(runner.sessionName, SESSION_NAME_NOTIFICATION_MAX_CHARS) || "Untitled session";
  const workdir = compactNotificationText(runner.dir, WORKDIR_NOTIFICATION_MAX_CHARS, true);
  return workdir ? `${name}\n${workdir}` : name;
}

/** Durable Web Push delivery with session identity and status. */
export async function createWebPushService({
  repository,
  subject = process.env.OYSTER_VAPID_SUBJECT || "mailto:oyster@localhost",
  longRunMs = DEFAULT_LONG_RUN_MS,
  now = Date.now,
  push = webPush,
  logger = console,
} = {}) {
  if (!repository || typeof repository.getVapidKeys !== "function") {
    const generated = push.generateVAPIDKeys();
    return Object.freeze({
      publicKey: generated.publicKey,
      handleRunnerEvent() {},
      async subscribe() { throw new Error("Web Push requires an Oyster server restart to finish database migration"); },
      async unsubscribe() { return 0; },
    });
  }
  let keys = await repository.getVapidKeys();
  if (!keys) {
    const generated = push.generateVAPIDKeys();
    keys = await repository.createVapidKeys({ ...generated, createdAt: new Date(now()).toISOString() });
  }
  push.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  async function send(payload) {
    const subscriptions = await repository.listSubscriptions();
    await Promise.allSettled(subscriptions.map(async (row) => {
      const subscription = { endpoint: row.endpoint, expirationTime: row.expiration_time, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await push.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
        await repository.markDelivered(row.endpoint, new Date(now()).toISOString());
      } catch (error) {
        if (error?.statusCode === HTTP_NOT_FOUND || error?.statusCode === HTTP_GONE) await repository.deleteSubscription(row.endpoint);
        else logger.error(`[oyster] web push delivery failed: ${error?.message ?? error}`);
      }
    }));
  }

  function handleRunnerEvent(runner, event) {
    if (event.type === "agent_start") {
      runner.webPushAgentStartedAt = now();
      return;
    }
    if (event.type === "agent_settled") {
      const startedAt = runner.webPushAgentStartedAt;
      runner.webPushAgentStartedAt = null;
      if (Number.isFinite(startedAt) && now() - startedAt >= longRunMs) {
        void send({
          title: "Oyster task finished",
          body: notificationBody(runner),
          url: notificationUrl(runner),
          tag: `agent-finished:${runner.id}`,
        });
      }
      return;
    }
    if (event.type === "extension_ui_request" && CLARIFICATION_METHODS.has(event.method)) {
      void send({
        title: "Oyster needs your input",
        body: notificationBody(runner),
        url: notificationUrl(runner),
        tag: `clarification:${runner.id}:${event.id}`,
      });
    }
  }

  return Object.freeze({
    publicKey: keys.publicKey,
    handleRunnerEvent,
    subscribe: (subscription) => repository.upsertSubscription({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      createdAt: new Date(now()).toISOString(),
    }),
    unsubscribe: (endpoint) => repository.deleteSubscription(endpoint),
  });
}
