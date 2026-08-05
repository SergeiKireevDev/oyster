const MAX_ENDPOINT_BYTES = 8 * 1024;
const MAX_KEY_BYTES = 512;

function validSubscription(value) {
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" || !value.keys || typeof value.keys !== "object") return false;
  if (!value.endpoint.startsWith("https://") || Buffer.byteLength(value.endpoint) > MAX_ENDPOINT_BYTES) return false;
  if (typeof value.keys.p256dh !== "string" || !value.keys.p256dh || Buffer.byteLength(value.keys.p256dh) > MAX_KEY_BYTES) return false;
  if (typeof value.keys.auth !== "string" || !value.keys.auth || Buffer.byteLength(value.keys.auth) > MAX_KEY_BYTES) return false;
  return value.expirationTime == null || (Number.isSafeInteger(value.expirationTime) && value.expirationTime >= 0);
}

export function createPushRoutes({ requestContext, pushService } = {}) {
  if (!requestContext || !pushService) throw new TypeError("push route dependencies are required");
  const { json, readJsonBody } = requestContext;
  return {
    "GET /push/config": (_req, res) => json(res, 200, { publicKey: pushService.publicKey }),
    "POST /push/subscription": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!validSubscription(body)) { json(res, 400, { error: "valid Web Push subscription required" }); return; }
      try {
        await pushService.subscribe(body);
        json(res, 201, { subscribed: true });
      } catch (error) {
        json(res, 503, { error: error?.message ?? "Web Push is unavailable" });
      }
    },
    "DELETE /push/subscription": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://") || Buffer.byteLength(body.endpoint) > MAX_ENDPOINT_BYTES) {
        json(res, 400, { error: "valid Web Push endpoint required" }); return;
      }
      await pushService.unsubscribe(body.endpoint);
      json(res, 200, { subscribed: false });
    },
  };
}
