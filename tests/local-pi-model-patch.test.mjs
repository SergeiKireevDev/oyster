import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { patchFireworksProvider, patchLocalPiModels } from "../scripts/patch-local-pi-models.mjs";

const fixture = `function models(data: Record<string, any>) {
  let selected = null;
\t\tif (data["kimi-for-coding"]?.models) {
\t\t\tconst kimiModels = data["kimi-for-coding"].models as Record<string, ModelsDevModel>;
      selected = kimiModels;
    }
  return selected;
}`;
const source = patchLocalPiModels(fixture);
const select = new Function(`${stripTypeScriptTypes(source)}; return models;`)();

test("Kimi build patch accepts renamed CN models and preserves legacy fallback", () => {
  const models = { "kimi-for-coding": { name: "Kimi", tool_call: true } };
  assert.equal(select({ "kimi-code-plan-cn": { models } }), models);
  assert.equal(select({ "kimi-for-coding": { models } }), models);
  assert.equal(select({ "kimi-code-plan-cn": { models }, "kimi-for-coding": { models: {} } }), models);
});

test("Kimi build patch never substitutes global-region credentials/catalog", () => {
  assert.equal(select({ "kimi-code-plan-global": { models: { global: {} } } }), null);
  assert.equal(select({}), null);
});

test("patch is idempotent and refuses unexpected or duplicated source", () => {
  assert.equal(patchLocalPiModels(source), source);
  assert.throws(() => patchLocalPiModels("unrelated generator"), /Unsupported pi model generator/);
  assert.throws(() => patchLocalPiModels(fixture + fixture), /Unsupported pi model generator/);
  assert.throws(() => patchLocalPiModels(source + fixture), /Unsupported pi model generator/);
});

test("pi Docker builds apply compatibility before model generation", () => {
  for (const name of ["Dockerfile", "Dockerfile.local-pi"]) {
    const dockerfile = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const patch = dockerfile.indexOf("RUN node /tmp/patch-local-pi-models.mjs /src/packages/ai/scripts/generate-models.ts /src/packages/ai/src/providers/fireworks.ts");
    assert.ok(patch >= 0, `${name} applies both compatibility patches`);
    assert.ok(patch < dockerfile.indexOf("npm run build --workspace packages/ai"), `${name} patches before build`);
    assert.match(dockerfile, /COPY scripts\/patch-local-pi-models\.mjs \/tmp\/patch-local-pi-models\.mjs/);
  }
});

test("bundled pi build applies compatibility before compiling the submodule", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["prepare:pi-models"], "node scripts/patch-local-pi-models.mjs pi/packages/ai/scripts/generate-models.ts pi/packages/ai/src/providers/fireworks.ts");
  assert.match(packageJson.scripts["build:pi"], /^npm run prepare:pi-models && cd pi &&/);
});

const fireworksFixture = `export function fireworksProvider(): Provider<"anthropic-messages" | "openai-completions"> {
\treturn createProvider({
    id: "fireworks",
    models: Object.values(FIREWORKS_MODELS),
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
  });
}`;

test("Fireworks patch fixes the API union independently of generated catalog contents", () => {
  const patched = patchFireworksProvider(fireworksFixture);
  assert.equal(patched, fireworksFixture.replace("return createProvider({", 'return createProvider<"anthropic-messages" | "openai-completions">({'));
  assert.equal(patchFireworksProvider(patched), patched);
  // A type-only fix: both stream implementations and runtime behavior remain.
  assert.equal(stripTypeScriptTypes(patched, { mode: "transform" }), stripTypeScriptTypes(fireworksFixture, { mode: "transform" }));
});

test("Fireworks patch refuses missing, duplicated, or mixed source patterns", () => {
  const patched = patchFireworksProvider(fireworksFixture);
  for (const input of ["unrelated provider", fireworksFixture + fireworksFixture, patched + fireworksFixture]) {
    assert.throws(() => patchFireworksProvider(input), /Unsupported pi Fireworks provider/);
  }
});

test("compatibility CLI patches both files idempotently and validates before writing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-pi-build-patch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const generatorPath = join(root, "generate-models.ts");
  const providerPath = join(root, "fireworks.ts");
  const cli = new URL("../scripts/patch-local-pi-models.mjs", import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  writeFileSync(generatorPath, fixture);
  writeFileSync(providerPath, "unexpected provider");
  const invalid = run(generatorPath, providerPath);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unsupported pi Fireworks provider/);
  assert.equal(readFileSync(generatorPath, "utf8"), fixture, "failed validation leaves the generator untouched");
  assert.equal(readFileSync(providerPath, "utf8"), "unexpected provider");

  writeFileSync(providerPath, fireworksFixture);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run(generatorPath, providerPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(generatorPath, "utf8"), patchLocalPiModels(fixture));
    assert.equal(readFileSync(providerPath, "utf8"), patchFireworksProvider(fireworksFixture));
  }
  assert.equal(run(generatorPath).status, 1, "both source paths are required");
});
