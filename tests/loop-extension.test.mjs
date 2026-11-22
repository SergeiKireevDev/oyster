import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../extensions/loop.ts", import.meta.url), "utf8");

async function loadStreamHelper() {
  const start = source.indexOf("async function readLoopStream");
  const end = source.indexOf("async function runLoop", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = `
    interface LoopResult { complete?: boolean; reason?: string; message?: string; error?: string; [key: string]: unknown; }
    type LoopEvent = LoopResult & { type?: string };
    ${source.slice(start, end)}
    export { readLoopStream };
  `;
  const { code } = await transform(snippet, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("loop extension reads split NDJSON progress through terminal completion", async () => {
  const { readLoopStream } = await loadStreamHelper();
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"started"}\n{"type":"progress","mess'));
      controller.enqueue(encoder.encode('age":"Iteration 1"}\n{"type":"heartbeat"}\n{"type":"complete","complete":true,"message":"done"}\n'));
      controller.close();
    },
  }));
  const progress = [];
  assert.deepEqual(await readLoopStream(response, (event) => progress.push(event.message)), { type: "complete", complete: true, message: "done" });
  assert.deepEqual(progress, ["Iteration 1"]);
});

test("loop extension rejects a stream that ends without completion", async () => {
  const { readLoopStream } = await loadStreamHelper();
  const response = new Response('{"type":"progress","message":"x"}\n');
  await assert.rejects(readLoopStream(response, () => {}), /ended without a completion event/);
});

test("loop extension registers the /loop command and the loop tool", () => {
  assert.match(source, /pi\.registerCommand\("loop"/);
  assert.match(source, /\/loop <plan\.md> <executable-validation-script>/);
  assert.match(source, /pi\.setSessionName\(`Loop: \$\{basename\(planPath\)\}`\)/);
  assert.match(source, /pi\.registerTool\(\{\s*name: "loop"/);
  assert.match(source, /never the whole plan/);
});

test("loop extension is a thin client of the Oyster loop engine", () => {
  assert.match(source, /ctx\.sessionManager\.isPersisted\(\)/);
  assert.match(source, /fetch\(`\$\{OYSTER_URL\}\/loops`/);
  assert.match(source, /accept: "application\/x-ndjson"/);
  assert.match(source, /parentSessionId: ctx\.sessionManager\.getSessionId\(\)/);
  assert.match(source, /dir: ctx\.cwd/);
  // Plan parsing, subagents, validation, and Git all belong to server/loops.mjs.
  assert.doesNotMatch(source, /pi\.exec|\/subagents|readFileSync|writeFileSync|buildIterationPrompt|complete\(/);
});
