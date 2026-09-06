import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGeminiOAuthCredentialSink,
  GEMINI_OAUTH_REDIRECT_URI,
  GEMINI_OAUTH_TOKEN_URL,
} from "../server/gemini-oauth-credential-sink.mjs";
import { createAmpOAuthCredentialSink } from "../server/amp-oauth-credential-sink.mjs";
import { createCodexOAuthCredentialSink } from "../server/codex-oauth-credential-sink.mjs";

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-native-oauth-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("Codex OAuth sink projects only the access token and clears only Oyster-managed auth", (t) => {
  const root = temporary(t);
  const sink = createCodexOAuthCredentialSink({ configDir: join(root, "codex") });
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-7" } })).toString("base64url");
  sink.project({ type: "oauth", access: `header.${payload}.signature`, refresh: "never-project-this", expires: Date.now() + 60_000 });
  const projected = JSON.parse(readFileSync(sink.credentialPath, "utf8"));
  assert.equal(projected.tokens.account_id, "account-7");
  assert.equal(projected.tokens.refresh_token, "");
  assert.doesNotMatch(JSON.stringify(projected), /never-project-this/);
  assert.equal(statSync(sink.credentialPath).mode & 0o777, 0o600);
  assert.equal(sink.remove(), true);

  writeFileSync(sink.credentialPath, JSON.stringify({ OPENAI_API_KEY: "user-owned" }));
  assert.equal(sink.remove(), false, "a native login without Oyster's marker is preserved");
  assert.equal(JSON.parse(readFileSync(sink.credentialPath, "utf8")).OPENAI_API_KEY, "user-owned");
});

test("Gemini OAuth sink completes one browser flow, persists privately, and refreshes centrally", async (t) => {
  const root = temporary(t);
  const requests = [];
  let clock = 1_000_000;
  const geminiBin = join(root, "gemini.js");
  writeFileSync(geminiBin, 'import "./oauth.js";\n');
  writeFileSync(join(root, "oauth.js"), 'var OAUTH_CLIENT_ID = "test-client";\nvar OAUTH_CLIENT_SECRET = "test-secret";\n');
  const sink = createGeminiOAuthCredentialSink({
    credentialPath: join(root, "gemini-oauth.json"),
    geminiBin,
    now: () => clock,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: Object.fromEntries(new URLSearchParams(options.body)) });
      return requests.length === 1
        ? response({ access_token: "access-one", refresh_token: "refresh-one", expires_in: 3600 })
        : response({ access_token: "access-two", expires_in: 3600 });
    },
  });
  let authorization;
  const credential = await sink.login({
    onAuth(value) { authorization = new URL(value.url); },
    onManualCodeInput: async () => "authorization-code",
    onPrompt: async () => { throw new Error("manual code callback should be used"); },
  });
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(authorization.searchParams.get("redirect_uri"), GEMINI_OAUTH_REDIRECT_URI);
  assert.equal(requests[0].url, GEMINI_OAUTH_TOKEN_URL);
  assert.equal(requests[0].body.code, "authorization-code");
  assert.deepEqual(credential, { type: "oauth", access: "access-one", refresh: "refresh-one", expires: clock + 3_600_000 });
  assert.equal(statSync(sink.credentialPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(sink.credentialPath, "utf8").includes("access-one"), true);

  clock += 3_500_000;
  const rotated = await sink.rotate({ marginMs: 30 * 60 * 1000 });
  assert.equal(rotated.outcome, "refreshed");
  assert.deepEqual(sink.read(), { type: "oauth", access: "access-two", refresh: "refresh-one", expires: clock + 3_600_000 });
  assert.equal(sink.remove(), true);
  assert.equal(sink.status().configured, false);
});

test("Gemini OAuth sink retains credentials and requests reauthentication after invalid_grant", async (t) => {
  const root = temporary(t);
  let calls = 0;
  const sink = createGeminiOAuthCredentialSink({
    credentialPath: join(root, "oauth.json"),
    clientId: "test-client", clientSecret: "test-secret",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ access_token: "access", refresh_token: "refresh", expires_in: 1 });
      return response({ error: "invalid_grant" }, 400);
    },
  });
  await sink.login({ onAuth() {}, onManualCodeInput: async () => "code", onPrompt: async () => "code" });
  const result = await sink.rotate({ force: true });
  assert.equal(result.outcome, "reauth_required");
  assert.equal(sink.status().configured, true);
});

test("Amp sink relays native device authorization and keeps the API key in Amp's own settings", async (t) => {
  const root = temporary(t);
  const executable = join(root, "fake-amp.mjs");
  const callsPath = join(root, "calls.txt");
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
if (process.argv.includes("login")) process.stderr.write("To log in, visit:\\nhttps://auth.ampcode.com/device?user_code=ABCD-EFGH\\nand confirm that the code shown matches: ABCD-EFGH\\n");
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  const settingsPath = join(root, "settings.json");
  const markerPath = join(root, "amp.connected");
  const sink = createAmpOAuthCredentialSink({ bin: executable, settingsPath, markerPath });
  let device;
  await sink.login({ onDeviceCode(value) { device = value; } });
  assert.deepEqual(device, { userCode: "ABCD-EFGH", verificationUri: "https://auth.ampcode.com/device?user_code=ABCD-EFGH" });
  assert.equal(sink.status().configured, true);
  assert.equal(statSync(markerPath).mode & 0o777, 0o600);
  assert.equal(await sink.remove(), true);
  assert.equal(sink.status().configured, false);
  const calls = readFileSync(callsPath, "utf8");
  assert.match(calls, /login --settings-file/);
  assert.match(calls, /logout --settings-file/);
});
