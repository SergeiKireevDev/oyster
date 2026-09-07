import test from "node:test";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { redactChildOutput } from "../server/runner-drivers/secret-output.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenRouterRouting, resolveOpenRouterKey, CODEX_OPENROUTER_ARGS } from "../server/openrouter-routing.mjs";
import { discoverCodexModels } from "../server/runner-drivers/native-models.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createClaudeCodeDriver } from "../server/runner-drivers/claude-code.mjs";
import { hasAuthenticatedProvider } from "../public/src/lib/newHarnessAuthentication.js";
import { createCredentialRoutes } from "../server/http/routes/credentialRoutes.mjs";
const canary = "sk-or-CREDENTIAL-CANARY";
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-or-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rows = new Map();
  const repository = { get: async (id) => rows.get(id), set: async (id, value) => rows.set(id, { value }) };
  const config = { PI_AGENT_DIR: root, CODEX_BIN: "codex", CLAUDE_CODE_BIN: "claude", AMP_BIN: "amp", CLAUDE_CONFIG_DIR: join(root, "native"), CLAUDE_CODE_PROJECTS_DIR: join(root, "native", "projects") };
  const save = (key) => writeFileSync(join(root, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key }, anthropic: { type: "oauth", access: "preserved" } }));
  save(canary);
  return { root, repository, config, save, rows };
}
test("routing is persisted, opt-in, lazy, key-free metadata and preserves native OAuth", async (t) => {
  const fixture = setup(t);
  let routing = await createOpenRouterRouting(fixture);
  assert.equal(routing.launch("codex"), null);
  assert.equal(hasAuthenticatedProvider(routing.decorate([{ provider: "openrouter", configured: true, credentialType: "api_key" }]), "codex"), false);
  await routing.select("codex", "openrouter");
  await routing.select("claude-code", "openrouter");
  routing = await createOpenRouterRouting(fixture);
  assert.equal(routing.launch("codex").env.OPENROUTER_API_KEY, canary);
  fixture.save("rotated-canary");
  assert.equal(routing.launch("codex").env.OPENROUTER_API_KEY, "rotated-canary");
  const claude = routing.launch("claude-code");
  assert.equal(claude.env.ANTHROPIC_API_KEY, "");
  assert.equal(claude.env.CLAUDE_CODE_OAUTH_TOKEN, "");
  assert.equal(claude.env.ANTHROPIC_BASE_URL, "https://openrouter.ai/api");
  assert.equal(realpathSync(join(claude.env.CLAUDE_CONFIG_DIR, "projects")), fixture.config.CLAUDE_CODE_PROJECTS_DIR);
  assert.match(readFileSync(join(fixture.root, "auth.json"), "utf8"), /preserved/);
  assert.doesNotMatch(JSON.stringify([routing.status(), [...fixture.rows], CODEX_OPENROUTER_ARGS, routing.decorate([])]), /canary|CREDENTIAL/);
  assert.equal(hasAuthenticatedProvider(routing.decorate([]), "codex"), true);
  assert.equal(hasAuthenticatedProvider(routing.decorate([]), "amp"), false);
  await assert.rejects(routing.select("gemini", "openrouter"));
  await assert.rejects(routing.select("amp", "openrouter"));
  await routing.select("codex", "native");
  assert.equal(routing.launch("codex"), null);
  assert.equal(resolveOpenRouterKey({ authPath: "/missing", env: { OPENROUTER_API_KEY: "bad\nkey" } }), null);
});

test("Codex fake CLI uses native model/list without account/read only for gateway", async (t) => {
  const { root } = setup(t);
  const cli = join(root, "fake.mjs");
  writeFileSync(cli, `#!/usr/bin/env node\nimport {createInterface} from 'node:readline';
const routed = process.argv.includes('model_provider="openrouter"');
createInterface({input:process.stdin}).on('line', line => {
 const q=JSON.parse(line); if(q.id === undefined) return;
 const result=q.method==='account/read'?{account:null}:q.method==='model/list'?{data:[{model:'anthropic/test',displayName:'Native catalog'}]}:{};
 console.log(JSON.stringify({id:q.id,...(routed && q.method==='account/read'?{error:{message:'must not require OAuth'}}:{result})}));
});`, { mode: 0o700 });
  assert.deepEqual(await discoverCodexModels({ bin: cli, cwd: root, env: { PATH: process.env.PATH } }), []);
  assert.deepEqual(await discoverCodexModels({ bin: cli, cwd: root, env: { PATH: process.env.PATH, OPENROUTER_API_KEY: canary }, provider: "openrouter" }), [{ provider: "openrouter", id: "anthropic/test", name: "Native catalog" }]);
});

test("native launches keep canary out of argv/config/description and support gateway model IDs", async (t) => {
  const fixture = setup(t);
  const routing = await createOpenRouterRouting(fixture);
  for (const [id, create] of [["codex", createCodexDriver], ["claude-code", createClaudeCodeDriver]]) {
    await routing.select(id, "openrouter");
    let invocation;
    const driver = create({ bin: "fake", resolveRoute: () => routing.launch(id), spawnImpl: (bin, args, options) => { invocation = { bin, args, options }; return { stdin: { writable: true, write() {} } }; } });
    const runner = { id: "r-test", dir: fixture.root };
    const launch = driver.launch({ runner, cwd: fixture.root });
    assert.doesNotMatch(JSON.stringify([invocation.args, invocation.options.env.OYSTER_HEADLESS_BRIDGE_CONFIG, launch.description]), /CREDENTIAL-CANARY/);
    const events = [];
    if (id === "codex") driver.decodeLine(runner, JSON.stringify({ type: "oyster.bridge.models", models: [{ provider: "openrouter", id: "anthropic/test" }] }));
    runner.driverEmit = (event) => events.push(event);
    assert.equal(driver.sendCommand(runner, launch.process, { id: "set", type: "set_model", provider: "openrouter", modelId: "anthropic/test" }), true);
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(events.some((event) => event.success === false), false);
    if (id === "codex") {
      await routing.select(id, "native");
      driver.launch({ runner, cwd: fixture.root });
      assert.equal(runner.driverRuntime.selectedModel, null);
      assert.equal(runner.driverRuntime.model, null);
      assert.deepEqual(runner.driverRuntime.availableModels, []);
      assert.equal(runner.driverRuntime.provider, "openai");
    }
  }
});

test("key mutations restart pi and routed harnesses; provider selection needs confirmation", async (t) => {
  const fixture = setup(t);
  const routing = await createOpenRouterRouting(fixture);
  await routing.select("codex", "openrouter");
  const restarted = [];
  let response;
  const routes = createCredentialRoutes({ openRouterRouting: routing,
    requestContext: { readBody: async (req) => JSON.stringify(req), json: (_res, code, body) => { response = { code, body }; } },
    credentialService: { listProviders: () => assert.fail("routing status must not refresh or project OAuth grants"), setApiKey: async (_provider, key) => fixture.save(key), removeApiKey: async () => fixture.save("") },
    getAmpAuthStatus: () => true,
    restartActiveRunners: async ({ harness }) => { restarted.push(harness); return { status: "restarted", runnerIds: [] }; }, logger: null,
  });
  await routes["GET /harness-providers"]({}, {});
  assert.equal(response.code, 200);
  assert.equal(response.body.ampAuthenticated, true);
  await routes["POST /harness-providers"]({ harness: "claude-code", provider: "openrouter" }, {}, new URL("http://test/harness-providers"));
  assert.equal(response.code, 400);
  for (const invalid of [null, false, [], 0]) {
    response = null;
    await routes["POST /harness-providers"](invalid, {}, new URL("http://test/harness-providers"));
    assert.equal(response.code, 400);
  }
  await routes["POST /api-keys"]({ provider: "openrouter", key: "new-canary", restart: true }, {}, new URL("http://test/api-keys"));
  assert.deepEqual(restarted, ["pi", "codex"]);
  assert.doesNotMatch(JSON.stringify(response), /new-canary/);
  restarted.length = 0;
  await routes["DELETE /api-keys"]({ provider: "openrouter", restart: true }, {}, new URL("http://test/api-keys"));
  assert.deepEqual(restarted, ["pi", "codex"]);
});

test("diagnostics redact credential canaries even across stream chunks", async () => {
  const stdout = new PassThrough();
  const child = redactChildOutput({ stdout }, [canary]);
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  stdout.write(canary.slice(0, 7));
  stdout.end(canary.slice(7) + "\n");
  await once(child.stdout, "end");
  assert.equal(output, "[REDACTED]\n");
});

test("Codex fake execution uses the same command-auth route as discovery", async (t) => {
  const fixture = setup(t);
  const routing = await createOpenRouterRouting(fixture);
  await routing.select("codex", "openrouter");
  const bin = join(fixture.root, "exec.mjs");
  const capture = join(fixture.root, "invocation.json");
  writeFileSync(bin, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),hasKey:process.env.OPENROUTER_API_KEY===${JSON.stringify(canary)},openai:process.env.OPENAI_API_KEY}));
console.log(JSON.stringify({type:'thread.started',thread_id:'test'}));`, { mode: 0o700 });
  const driver = createCodexDriver({ bin, resolveRoute: () => routing.launch("codex") });
  const child = driver.launch({ runner: { id: "r-fake" }, cwd: fixture.root }).process;
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake execution timed out")), 5000);
    lines.on("line", (line) => { if (JSON.parse(line).type === "oyster.bridge.turn_exit") { clearTimeout(timer); resolve(); } });
  });
  child.stdin.write(JSON.stringify({ type: "run", prompt: "fake only", model: "openai/test" }) + "\n");
  await finished;
  child.stdin.end();
  lines.close();
  const invocation = JSON.parse(readFileSync(capture, "utf8"));
  assert.equal(invocation.hasKey, true);
  assert.equal(invocation.openai, "");
  for (const value of CODEX_OPENROUTER_ARGS) assert.ok(invocation.args.includes(value));
  assert.ok(invocation.args.includes("openai/test"));
  assert.doesNotMatch(JSON.stringify(invocation), /CREDENTIAL-CANARY/);
});

test("Amp workflow gates disclosure on native authentication, never uses a Pi key as account login", () => {
  const ui = readFileSync(new URL("../public/src/components/HarnessProviderSettings.svelte", import.meta.url), "utf8");
  assert.match(ui, /if !status.ampAuthenticated/);
  assert.match(ui, /if ampDisclosureConfirmed/);
  assert.match(ui, /uploads my OpenRouter key to my Amp account/);
  assert.match(ui, /amp config model-providers add-router openrouter --personal --name Oyster --active --api-key-file -/);
  assert.match(ui, /edit-router CONNECTION_ID --api-key-file -/);
  assert.equal(hasAuthenticatedProvider([{ provider: "openrouter", configured: true, credentialType: "api_key", harnesses: ["pi"] }], "amp"), false);
});
