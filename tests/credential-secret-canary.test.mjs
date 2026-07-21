import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPiCredentialService } from "../pi-credential-service.mjs";
import { createRestartActiveRunners } from "../runner-restart-service.mjs";
import { createCredentialRoutes } from "../http/routes/credentialRoutes.mjs";
import { openAppStore } from "../persistence/appStore.mjs";

const LOCAL_PI = process.env.PI_BIN ?? "/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js";

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

function sqliteTextContains(databasePath, canary) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const { name } of database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      for (const column of database.prepare(`PRAGMA table_info(${quoted})`).all()) {
        if (!/TEXT/i.test(column.type)) continue;
        const field = `"${column.name.replaceAll('"', '""')}"`;
        if (database.prepare(`SELECT 1 FROM ${quoted} WHERE instr(${field}, ?) > 0 LIMIT 1`).get(canary)) return true;
      }
    }
    return false;
  } finally {
    database.close();
  }
}

function routeContext() {
  return {
    json(res, status, body) { res.status = status; res.body = body; },
    async readBody(req) { return JSON.stringify(req.body); },
  };
}

test("credential canary remains only in pi auth.json and is absent after removal", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-credential-canary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { canary_provider: {
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions",
    models: [{ id: "canary-model", name: "Canary Model", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  const appDatabase = join(root, "pi-lot-ui.sqlite");
  const appStore = openAppStore({ databasePath: appDatabase });
  appStore.repositories.settings.set("ordinary", JSON.stringify({ theme: "dark" }), "now");
  appStore.close();

  const canary = `PI_UI_CREDENTIAL_CANARY_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const runners = new Map([
    ["active", { id: "active", proc: {}, resumeQueue: [] }],
    ["inactive", { id: "inactive", proc: null, resumeQueue: [] }],
  ]);
  const events = [];
  const restart = createRestartActiveRunners({
    runners: () => runners,
    stopRunner(runner) { runner.proc = null; events.push({ type: "stopped", runner: runner.id }); },
    startRunner(runner) { runner.proc = { replacement: true }; events.push({ type: "started", runner: runner.id }); },
    delay: async () => {},
  });
  const service = createPiCredentialService({ config: { PI_BIN: LOCAL_PI, PI_AGENT_DIR: agentDir } });
  const logs = [];
  const routes = createCredentialRoutes({
    requestContext: routeContext(), credentialService: service, restartActiveRunners: restart,
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });

  const added = {};
  await routes["POST /api-keys"]({ body: { provider: "canary_provider", key: canary, restart: true } }, added);
  assert.equal(added.status, 200);
  const listed = {};
  await routes["GET /api-keys"]({}, listed);
  assert.equal(listed.status, 200);

  for (const value of [added.body, listed.body, events, [...runners.values()], logs]) {
    assert.doesNotMatch(JSON.stringify(value), new RegExp(canary));
  }
  assert.equal(sqliteTextContains(appDatabase, canary), false);
  const clientFiles = [...filesBelow(join(process.cwd(), "public", "src")), ...filesBelow(join(process.cwd(), "dist"))];
  assert.equal(clientFiles.some((path) => readFileSync(path).includes(Buffer.from(canary))), false);
  const authPath = join(agentDir, "auth.json");
  assert.match(readFileSync(authPath, "utf8"), new RegExp(canary));

  const removed = {};
  await routes["DELETE /api-keys"]({ body: { provider: "canary_provider", restart: true } }, removed);
  assert.equal(removed.status, 200);
  assert.doesNotMatch(JSON.stringify(removed.body), new RegExp(canary));
  assert.doesNotMatch(readFileSync(authPath, "utf8"), new RegExp(canary));
  assert.equal(sqliteTextContains(appDatabase, canary), false);
});
