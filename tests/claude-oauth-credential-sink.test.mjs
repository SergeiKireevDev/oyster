import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_SCOPES,
  createClaudeOAuthCredentialSink,
} from "../server/claude-oauth-credential-sink.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "claude-oauth-sink-"));
  return { root, configDir: join(root, ".claude"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const credential = (suffix = "one") => ({
  type: "oauth",
  access: `access-${suffix}-canary`,
  refresh: `refresh-${suffix}-canary`,
  expires: 1_800_000_000_000,
});

test("Claude OAuth sink stores an independent credential atomically in Claude Code's schema", () => {
  const item = fixture();
  try {
    mkdirSync(item.configDir);
    const path = join(item.configDir, ".credentials.json");
    writeFileSync(path, JSON.stringify({ designOauth: { accessToken: "untouched-canary" }, extra: true }), { mode: 0o644 });
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    sink.project(credential());

    const stored = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(stored.claudeAiOauth, {
      accessToken: "access-one-canary",
      refreshToken: "refresh-one-canary",
      expiresAt: 1_800_000_000_000,
      scopes: [...CLAUDE_OAUTH_SCOPES],
      clientId: CLAUDE_OAUTH_CLIENT_ID,
    });
    assert.deepEqual(stored.designOauth, { accessToken: "untouched-canary" });
    assert.equal(stored.extra, true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, "utf8").endsWith("\n"), true);
    assert.deepEqual(readdirSync(item.configDir), [".credentials.json"]);
  } finally {
    item.cleanup();
  }
});

test("Claude OAuth sink replaces and removes only the Anthropic OAuth entry", () => {
  const item = fixture();
  try {
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    assert.deepEqual(sink.status(), { configured: false });
    sink.project(credential("old"));
    assert.deepEqual(sink.status(), { configured: true });
    sink.project(credential("new"));
    let stored = JSON.parse(readFileSync(sink.credentialPath, "utf8"));
    assert.equal(stored.claudeAiOauth.accessToken, "access-new-canary");
    assert.equal(sink.remove(), true);
    assert.deepEqual(sink.status(), { configured: false });
    stored = JSON.parse(readFileSync(sink.credentialPath, "utf8"));
    assert.deepEqual(stored, {});
    assert.equal(sink.remove(), false);
  } finally {
    item.cleanup();
  }
});

test("Claude OAuth sink fails closed on malformed files, symlinks, and invalid credentials", () => {
  const item = fixture();
  try {
    mkdirSync(item.configDir);
    const path = join(item.configDir, ".credentials.json");
    writeFileSync(path, "{broken", { mode: 0o600 });
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    assert.throws(() => sink.project(credential()), { code: "claude_credential_sync_failed" });
    assert.equal(readFileSync(path, "utf8"), "{broken");

    rmSync(path);
    const target = join(item.root, "target.json");
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, path);
    assert.throws(() => sink.project(credential()), { code: "claude_credential_sync_failed" });
    assert.equal(readFileSync(target, "utf8"), "{}");

    rmSync(path);
    assert.throws(() => sink.project({ type: "oauth", access: "", refresh: "x", expires: 1 }), {
      code: "claude_credential_sync_failed",
    });
  } finally {
    item.cleanup();
  }
});

test("Claude OAuth sink validates its configured root", () => {
  assert.throws(() => createClaudeOAuthCredentialSink({ configDir: "relative" }), /absolute Claude config/);
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

test("Claude OAuth sink treats Claude's blanked-out tokens as not configured instead of corrupt", () => {
  const item = fixture();
  try {
    mkdirSync(item.configDir);
    const path = join(item.configDir, ".credentials.json");
    // Claude Code rewrites the entry this way after a failed refresh.
    writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, scopes: [], clientId: CLAUDE_OAUTH_CLIENT_ID } }));
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    assert.deepEqual(sink.status(), { configured: false });
    assert.equal(sink.read(), null);
    sink.project(credential());
    assert.deepEqual(sink.read(), { type: "oauth", access: "access-one-canary", refresh: "refresh-one-canary", expires: 1_800_000_000_000, refreshExpires: null });
  } finally {
    item.cleanup();
  }
});

test("Claude OAuth sink rotates the grant through the token endpoint and persists both expiries", async () => {
  const item = fixture();
  try {
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    sink.project(credential());
    const path = join(item.configDir, ".credentials.json");
    const before = JSON.parse(readFileSync(path, "utf8"));
    before.claudeAiOauth.subscriptionType = "max";
    writeFileSync(path, JSON.stringify(before));
    const requests = [];
    const rotated = await sink.refresh({
      now: () => 1_700_000_000_000,
      async fetchImpl(url, init) {
        requests.push({ url, init });
        return jsonResponse(200, { access_token: "access-two-canary", refresh_token: "refresh-two-canary", expires_in: 28_800, refresh_token_expires_in: 2_592_000, scope: "user:inference" });
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://platform.claude.com/v1/oauth/token");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), { grant_type: "refresh_token", client_id: CLAUDE_OAUTH_CLIENT_ID, refresh_token: "refresh-one-canary" });
    assert.deepEqual(rotated, {
      type: "oauth", access: "access-two-canary", refresh: "refresh-two-canary",
      expires: 1_700_000_000_000 + 28_800_000 - 300_000, refreshExpires: 1_700_000_000_000 + 2_592_000_000, rotated: true,
    });
    const stored = JSON.parse(readFileSync(path, "utf8")).claudeAiOauth;
    assert.equal(stored.accessToken, "access-two-canary");
    assert.equal(stored.refreshToken, "refresh-two-canary");
    assert.equal(stored.expiresAt, rotated.expires);
    assert.equal(stored.refreshTokenExpiresAt, rotated.refreshExpires);
    assert.equal(stored.subscriptionType, "max", "keys Claude Code added are preserved");
    assert.deepEqual(stored.scopes, [...CLAUDE_OAUTH_SCOPES]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    item.cleanup();
  }
});

test("Claude OAuth sink reports invalid_grant distinctly and never clobbers a concurrent re-login", async () => {
  const item = fixture();
  try {
    const sink = createClaudeOAuthCredentialSink({ configDir: item.configDir });
    sink.project(credential());
    const path = join(item.configDir, ".credentials.json");

    await assert.rejects(sink.refresh({ fetchImpl: async () => jsonResponse(400, { error: "invalid_grant", error_description: "revoked" }) }), (error) => {
      assert.equal(error.code, "claude_oauth_refresh_failed");
      assert.equal(error.status, 400);
      assert.equal(error.invalidGrant, true);
      return true;
    });
    await assert.rejects(sink.refresh({ fetchImpl: async () => { throw new Error("ECONNRESET"); } }), (error) => {
      assert.equal(error.code, "claude_oauth_refresh_failed");
      assert.equal(error.invalidGrant, false);
      return true;
    });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).claudeAiOauth.refreshToken, "refresh-one-canary", "failures leave the stored grant untouched");

    const adopted = await sink.refresh({
      async fetchImpl() {
        sink.project(credential("login")); // a UI re-login lands while the request is in flight
        return jsonResponse(200, { access_token: "stale-rotation", refresh_token: "stale-refresh", expires_in: 28_800 });
      },
    });
    assert.equal(adopted.rotated, false);
    assert.equal(adopted.refresh, "refresh-login-canary");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).claudeAiOauth.accessToken, "access-login-canary");
    await assert.rejects(createClaudeOAuthCredentialSink({ configDir: join(item.root, "empty") }).refresh({ fetchImpl: async () => { throw new Error("must not be called"); } }), /no stored Anthropic OAuth credential/);
  } finally {
    item.cleanup();
  }
});
