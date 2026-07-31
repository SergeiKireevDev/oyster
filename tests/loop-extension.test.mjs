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
    export { checklistItems, firstUncheckedItem, checkItem, commitMessage, buildIterationPrompt };
  `;
  const { code } = await transform(snippet, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadStreamHelper() {
  const start = source.indexOf("async function readSubagentStream");
  const end = source.indexOf("async function runSubagent", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = `
    interface SubagentResult { ok?: boolean; output?: string; errorLog?: string; error?: string; }
    ${source.slice(start, end)}
    export { readSubagentStream };
  `;
  const { code } = await transform(snippet, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("loop parses split NDJSON subagent events through terminal completion", async () => {
  const { readSubagentStream } = await loadStreamHelper();
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"started"}\n{"type":"heart'));
      controller.enqueue(encoder.encode('beat"}\n{"type":"complete","ok":true,"output":"done"}\n'));
      controller.close();
    },
  }));
  assert.deepEqual(await readSubagentStream(response), { type: "complete", ok: true, output: "done" });
});

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

test("loop derives concise meaningful commit messages from checklist items", async () => {
  const { commitMessage } = await loadHelpers();
  assert.equal(commitMessage("  Add   retry handling\nfor failed jobs  "), "Add retry handling for failed jobs");
  assert.equal(commitMessage("x".repeat(100)), "x".repeat(72));
});

test("loop first iteration context contains only instructions and plan", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [ ] implement it");
  assert.match(prompt, /# Plan\n\n- \[ \] implement it/);
  assert.match(prompt, /state what you attempted, what succeeded, what failed/);
  assert.doesNotMatch(prompt, /Previous iteration output|Previous iteration failure log/);
});

test("loop successful follow-up context contains checked plan and prior output", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [x] first\n- [ ] second", {
    succeeded: true,
    output: "implemented first",
  });
  assert.match(prompt, /- \[x\] first\n- \[ \] second/);
  assert.match(prompt, /# Previous iteration output\n\nimplemented first/);
  assert.doesNotMatch(prompt, /Previous iteration failure log/);
});

test("loop failed follow-up context keeps item unchecked and includes failure details", async () => {
  const { buildIterationPrompt } = await loadHelpers();
  const prompt = buildIterationPrompt("- [x] first\n- [ ] second", {
    succeeded: false,
    output: "attempted second",
    validationLog: "tests failed",
  });
  assert.match(prompt, /- \[x\] first\n- \[ \] second/);
  assert.match(prompt, /# Previous iteration output\n\nattempted second/);
  assert.match(prompt, /# Previous iteration failure log\n\ntests failed/);
});

test("loop registers the /loop command", () => {
  assert.match(source, /pi\.registerCommand\("loop"/);
  assert.match(source, /\/loop <plan\.md> <executable-validation-script>/);
  assert.doesNotMatch(source, /\[max-iterations\]|DEFAULT_MAX_ITERATIONS|maxIterations/);
  assert.match(source, /pi\.setSessionName\(`Loop: \$\{basename\(planPath\)\}`\)/);
  assert.match(source, /await runLoop\(pi, ctx/);
});

test("loop uses Oyster-managed persisted child runners and directly executes validation", () => {
  assert.doesNotMatch(source, /"--no-session"/);
  assert.match(source, /ctx\.sessionManager\.isPersisted\(\)/);
  assert.match(source, /fetch\(`\$\{OYSTER_URL\}\/subagents`/);
  assert.match(source, /accept: "application\/x-ndjson"/);
  assert.match(source, /await readSubagentStream\(response\)/);
  assert.match(source, /stream ended without a completion event/);
  assert.doesNotMatch(source, /const result = await response\.json/);
  assert.match(source, /parentSessionId: ctx\.sessionManager\.getSessionId\(\)/);
  assert.match(source, /`Loop iteration \$\{iteration\}:/);
  assert.doesNotMatch(source, /getPiInvocation|--mode", "json"/);
  assert.match(source, /if \(subagent\.ok\) \{/);
  assert.match(source, /validation = await runValidation/);
  assert.match(source, /subagent failed; retrying/);
  assert.match(source, /pi\.exec\(validationPath, \[\]/);
  assert.match(source, /writeFileSync\(planPath, planBefore/);
  assert.match(source, /validation\?\.ok === true/);
  assert.match(source, /writeFileSync\(planPath, checkItem\(planBefore, item\)/);
  assert.match(source, /await commitSuccessfulStep\(pi, ctx, item\.text, signal\)/);
  assert.match(source, /pi\.exec\("git", \["add", "-A"\]/);
  assert.match(source, /pi\.exec\("git", \["commit", "--allow-empty", "--no-gpg-sign", "-m", commitMessage\(item\)\]/);
  assert.ok(
    source.indexOf("validation = await runValidation") < source.indexOf("await commitSuccessfulStep"),
    "validation must pass before a loop step is committed",
  );
});

test("loop has no total iteration limit and stops after one step stalls 20 times", () => {
  assert.match(source, /const MAX_STALLED_ITERATIONS = 20/);
  assert.match(source, /for \(let iteration = 1; ; iteration \+= 1\)/);
  assert.match(source, /if \(succeeded\) \{[\s\S]*stalledIterations = 0;[\s\S]*stalledIterations \+= 1/);
  assert.match(source, /stalledIterations >= MAX_STALLED_ITERATIONS/);
  assert.match(source, /failed to advance for \$\{MAX_STALLED_ITERATIONS\} consecutive iterations/);
});
