import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../extensions/goal-loop.ts", import.meta.url), "utf8");

async function loadInferValidation() {
  const start = source.indexOf("function inferValidation(");
  const end = source.indexOf("\nfunction findDefaultPlan", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = `${source.slice(start, end)}\nexport { inferValidation };`;
  const { code } = await transform(snippet, { loader: "ts", format: "esm", target: "es2022" });
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)).inferValidation;
}

test("goal-loop contains no project-specific defaults", () => {
  assert.doesNotMatch(source, /tree-pi|pi-lot-ui|migration-svelte/i);
  assert.doesNotMatch(source, /docker build|npm (?:run build|test)/i);
});

test("goal-loop can start regardless of pi project trust", () => {
  assert.doesNotMatch(source, /isProjectTrusted|untrusted project/);
});

test("goal-loop infers the required validation block from a plan", async () => {
  const inferValidation = await loadInferValidation();
  const plan = `# Plan

## Implementation

\`\`\`sh
echo unrelated
\`\`\`

## Validation

Run the full suite:

\`\`\`bash
make build
make test
\`\`\`

Optionally run this targeted check:

\`\`\`sh
make test-one
\`\`\`
`;
  const [check] = inferValidation(plan);
  assert.equal(check.command, "bash");
  assert.deepEqual(check.args, ["-eu", "-c", "make build\nmake test"]);
  assert.match(check.label, /Validation/);
});

test("goal-loop recognizes validation prose without a dedicated heading", async () => {
  const inferValidation = await loadInferValidation();
  const [check] = inferValidation(`- Validate every step:

\`\`\`sh
cargo test --all
\`\`\`
`);
  assert.equal(check.command, "sh");
  assert.equal(check.args.at(-1), "cargo test --all");
});

test("goal-loop rejects plans without an identifiable validation block", async () => {
  const inferValidation = await loadInferValidation();
  assert.throws(() => inferValidation("# Plan\n\n- [ ] Implement it\n"), /Could not infer validation/);
});
