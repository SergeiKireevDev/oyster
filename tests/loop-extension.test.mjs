import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../extensions/loop.ts", import.meta.url), "utf8");

async function loadHelpers() {
  const start = source.indexOf("// PURE_HELPERS_START");
  const end = source.indexOf("// PURE_HELPERS_END");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const helpers = source.slice(start + "// PURE_HELPERS_START".length, end);
  const snippet = `
    const CONTEXT_OUTPUT_LIMIT = 50 * 1024;
    interface ChecklistItem { line: number; checked: boolean; text: string; }
    interface PreviousIteration { output: string; validationLog?: string; succeeded: boolean; }
    ${helpers}
    export { checklistItems, firstUncheckedItem, checkItem, buildIterationPrompt };
  `;
  const { code } = await transform(snippet, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("loop parses Markdown checklists and checks exactly the selected item", async () => {
  const { checklistItems, firstUncheckedItem, checkItem } = await loadHelpers();
  const plan = "# Plan\n\n- [x] done\n- [ ] first\n1. [ ] second\n";
  assert.deepEqual(checklistItems(plan).map(({ checked, text }) => ({ checked, text })), [
    { checked: true, text: "done" },
    { checked: false, text: "first" },
    { checked: false, text: "second" },
  ]);
  const target = firstUncheckedItem(plan);
  assert.equal(target.text, "first");
  assert.equal(checkItem(plan, target), "# Plan\n\n- [x] done\n- [x] first\n1. [ ] second\n");
});

test("loop first iteration context contains only instructions and plan", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [ ] implement it");
  assert.match(prompt, /# Plan\n\n- \[ \] implement it/);
  assert.doesNotMatch(prompt, /Previous iteration output|Validation executable error log/);
});

test("loop successful follow-up context contains checked plan and prior output", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [x] first\n- [ ] second", {
    succeeded: true,
    output: "implemented first",
  });
  assert.match(prompt, /- \[x\] first\n- \[ \] second/);
  assert.match(prompt, /# Previous iteration output\n\nimplemented first/);
  assert.doesNotMatch(prompt, /Validation executable error log/);
});

test("loop failed follow-up context keeps item unchecked and includes validation errors", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [x] first\n- [ ] second", {
    succeeded: false,
    output: "attempted second",
    validationLog: "tests failed",
  });
  assert.match(prompt, /- \[x\] first\n- \[ \] second/);
  assert.match(prompt, /# Previous iteration output\n\nattempted second/);
  assert.match(prompt, /# Validation executable error log\n\ntests failed/);
});

test("loop registers the /loop command", () => {
  assert.match(source, /pi\.registerCommand\("loop"/);
  assert.match(source, /\/loop <plan\.md> <executable-validation-script> \[max-iterations\]/);
  assert.match(source, /await runLoop\(pi, ctx/);
});

test("loop uses isolated pi JSON subprocesses and directly executes validation", () => {
  assert.match(source, /\["--mode", "json", "-p", "--no-session", "--exclude-tools", "loop", prompt\]/);
  assert.match(source, /pi\.exec\(validationPath, \[\]/);
  assert.match(source, /writeFileSync\(planPath, planBefore/);
  assert.match(source, /validation\.ok/);
});
