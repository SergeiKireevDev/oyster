import test from "node:test";
import assert from "node:assert/strict";
import { createCloudAuthorizationService, CloudAuthorizationError } from "../oyster-hub/cloud-authorization.mjs";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const config = {
  digitalocean: { clientId: "do-client", clientSecret: "do-secret", redirectUrl: "https://hub.example/cloud/oauth/digitalocean/callback" },
  gcp: { clientId: "google-client", clientSecret: "google-secret", redirectUrl: "https://hub.example/cloud/oauth/gcp/callback" },
};

test("DigitalOcean browser authorization uses state and PKCE without exposing tokens in snapshots", async () => {
  const saved = [];
  const canary = "dop_oauth_secret_canary";
  const service = createCloudAuthorizationService({
    config,
    saveCredential: async (...args) => saved.push(args),
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith("/v1/oauth/token")) {
        const body = new URLSearchParams(options.body);
        assert.equal(body.get("client_secret"), "do-secret");
        assert.ok(body.get("code_verifier"));
        return json({ access_token: canary, token_type: "bearer", scope: "read write" });
      }
      assert.equal(options.headers.authorization, `Bearer ${canary}`);
      return json({ account: { email: "owner@example.com" } });
    },
  });

  const started = service.start("digitalocean");
  const authorization = new URL(started.authorizationUrl);
  assert.equal(authorization.origin, "https://cloud.digitalocean.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorization.searchParams.get("state"));
  const completed = await service.callback("digitalocean", { state: authorization.searchParams.get("state"), code: "one-use-code" });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.account, "owner@example.com");
  assert.equal(JSON.stringify(completed).includes(canary), false);
  assert.equal(saved[0][0], "digitalocean");
  assert.equal(saved[0][1].accessToken, canary);
  await assert.rejects(
    service.callback("digitalocean", { state: authorization.searchParams.get("state"), code: "replay" }),
    (error) => error instanceof CloudAuthorizationError && error.code === "invalid_callback",
  );
});

test("Google browser authorization requests offline access and stores refresh credentials server-side", async () => {
  const saved = [];
  const service = createCloudAuthorizationService({
    config,
    saveCredential: async (...args) => saved.push(args),
    fetchImpl: async (url) => String(url).includes("oauth2.googleapis.com/token")
      ? json({ access_token: "google-access-canary", refresh_token: "google-refresh-canary", expires_in: 3600 })
      : json({ email: "admin@example.com" }),
  });
  const started = service.start("gcp");
  const authorization = new URL(started.authorizationUrl);
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.match(authorization.searchParams.get("scope"), /compute/);
  const completed = await service.callback("gcp", { state: authorization.searchParams.get("state"), code: "google-code" });
  assert.equal(completed.requiresProject, true);
  assert.equal(completed.account, "admin@example.com");
  assert.equal(saved[0][1].refreshToken, "google-refresh-canary");
  assert.equal(JSON.stringify(completed).includes("google-refresh-canary"), false);
});

test("authorization flows reject unconfigured providers and erase authorization URLs on cancel", () => {
  const service = createCloudAuthorizationService({ config: {}, saveCredential: async () => {} });
  assert.throws(() => service.start("digitalocean"), (error) => error.code === "oauth_not_configured");
  const configured = createCloudAuthorizationService({ config, saveCredential: async () => {} });
  const started = configured.start("gcp");
  const cancelled = configured.cancel(started.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal("authorizationUrl" in cancelled, false);
});
