const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

/** Authenticated read-only subscription usage for OAuth-connected providers. */
export function createSubscriptionUsageRoutes({ requestContext, usageService } = {}) {
  if (typeof requestContext?.json !== "function") throw new TypeError("requestContext is required");
  if (typeof usageService?.list !== "function") throw new TypeError("usageService is required");
  const { json } = requestContext;
  return {
    "GET /subscription-usage": async (_req, res, url) => {
      try {
        const usage = await usageService.list({ force: url?.searchParams?.get("refresh") === "1" });
        json(res, HTTP_OK, { usage });
      } catch {
        json(res, HTTP_SERVICE_UNAVAILABLE, { error: "subscription usage unavailable" });
      }
    },
  };
}
