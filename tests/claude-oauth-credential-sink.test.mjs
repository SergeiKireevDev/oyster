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

test("Claude OAuth sink projects Pi credentials atomically in Claude Code's schema", () => {
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
    sink.project(credential("old"));
    sink.project(credential("new"));
    let stored = JSON.parse(readFileSync(sink.credentialPath, "utf8"));
    assert.equal(stored.claudeAiOauth.accessToken, "access-new-canary");
    assert.equal(sink.remove(), true);
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
