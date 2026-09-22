const BYTES_PER_KIBIBYTE = 1024;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MAX_ENDPOINT_KIBIBYTES = 8;

const MAX_ENDPOINT_BYTES = MAX_ENDPOINT_KIBIBYTES * BYTES_PER_KIBIBYTE;
const MAX_KEY_BYTES = 512;

function validEndpoint(endpoint) {
  return typeof endpoint === "string" && endpoint.startsWith("https://") && Buffer.byteLength(endpoint) <= MAX_ENDPOINT_BYTES;
}

function validKey(value) {
  return typeof value === "string" && Boolean(value) && Buffer.byteLength(value) <= MAX_KEY_BYTES;
}

function validExpiration(value) {
  return value == null || (Number.isSafeInteger(value) && value >= 0);
}

function validSubscription(value) {
  if (!value || typeof value !== "object" || !value.keys || typeof value.keys !== "object") return false;
  return validEndpoint(value.endpoint) && validKey(value.keys.p256dh) && validKey(value.keys.auth) && validExpiration(value.expirationTime);
}

export function createPushRoutes({ requestContext, pushService } = {}) {
  if (!requestContext || !pushService) throw new TypeError("push route dependencies are required");
  const { json, readJsonBody } = requestContext;
  return {
    "GET /push/config": (_req, res) => json(res, HTTP_OK, { publicKey: pushService.publicKey }),
    "POST /push/subscription": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!validSubscription(body)) { json(res, HTTP_BAD_REQUEST, { error: "valid Web Push subscription required" }); return; }
      try {
        await pushService.subscribe(body);
        json(res, HTTP_CREATED, { subscribed: true });
      } catch (error) {
        json(res, HTTP_SERVICE_UNAVAILABLE, { error: error?.message ?? "Web Push is unavailable" });
      }
    },
    "DELETE /push/subscription": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://") || Buffer.byteLength(body.endpoint) > MAX_ENDPOINT_BYTES) {
        json(res, HTTP_BAD_REQUEST, { error: "valid Web Push endpoint required" }); return;
      }
      await pushService.unsubscribe(body.endpoint);
      json(res, HTTP_OK, { subscribed: false });
    },
  };
}
