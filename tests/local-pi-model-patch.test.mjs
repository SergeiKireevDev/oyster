import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { patchLocalPiModels } from "../scripts/patch-local-pi-models.mjs";

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
    const patch = dockerfile.indexOf("RUN node /tmp/patch-local-pi-models.mjs /src/packages/ai/scripts/generate-models.ts");
    assert.ok(patch >= 0, `${name} applies the Kimi patch`);
    assert.ok(patch < dockerfile.indexOf("npm run build --workspace packages/ai"), `${name} patches before build`);
    assert.match(dockerfile, /COPY scripts\/patch-local-pi-models\.mjs \/tmp\/patch-local-pi-models\.mjs/);
  }
});

test("bundled pi build applies compatibility before compiling the submodule", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["prepare:pi-models"], "node scripts/patch-local-pi-models.mjs pi/packages/ai/scripts/generate-models.ts");
  assert.match(packageJson.scripts["build:pi"], /^npm run prepare:pi-models && cd pi &&/);
});
