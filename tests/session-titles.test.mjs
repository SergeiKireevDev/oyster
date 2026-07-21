import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { cleanSessionTitle, firstSessionMessages, sessionTitlePrompt, summarizeSessionTitle } from "../server/session-titles.mjs";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = (signal) => { proc.signal = signal; };
  return proc;
}

test("session title context uses the first ten messages only", () => {
  const messages = Array.from({ length: 11 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index + 1}` }));
  const transcript = firstSessionMessages(messages);
  assert.match(transcript, /1\. user: message-1/);
  assert.match(transcript, /10\. assistant: message-10/);
  assert.doesNotMatch(transcript, /message-11/);
  assert.match(sessionTitlePrompt(messages), /<transcript>[\s\S]*message-10[\s\S]*<\/transcript>/);
});

test("session title context safely renders structured message content", () => {
  const transcript = firstSessionMessages([{ role: "assistant", content: [
    { type: "thinking", thinking: "secret chain" },
    { type: "toolCall", name: "read", arguments: { path: "app.mjs" } },
    { type: "text", text: "Implemented the route" },
  ] }]);
  assert.match(transcript, /\[thinking omitted\]/);
  assert.doesNotMatch(transcript, /secret chain/);
  assert.match(transcript, /tool call: read/);
  assert.match(transcript, /Implemented the route/);
});

test("session title summarizer uses the configured model and returns a clean title", async () => {
  const calls = [];
  const process = fakeProcess();
  const piProcesses = {
    ephemeral(args, options) { calls.push({ args, options }); return process; },
  };
  let spawned = null;
  const result = summarizeSessionTitle(piProcesses, {
    cwd: "/workspace",
    messages: [{ role: "user", content: "Fix OAuth redirects" }],
    model: { provider: "anthropic", id: "claude-sonnet" },
    onSpawn: (value) => { spawned = value; },
  });
  process.stdout.write('Title: "Fix OAuth Redirect Handling"\n');
  process.emit("exit", 0);

  assert.equal(await result, "Fix OAuth Redirect Handling");
  assert.equal(spawned, process);
  assert.equal(calls[0].options.cwd, "/workspace");
  assert.ok(calls[0].args.includes("anthropic/claude-sonnet"));
  assert.ok(calls[0].args.includes("--no-tools"));
  assert.ok(calls[0].args.includes("--no-context-files"));
  assert.equal(calls[0].args.at(-2), "-p");
  assert.match(calls[0].args.at(-1), /Fix OAuth redirects/);
});

test("session title cleanup strips formatting and bounds output", () => {
  assert.equal(cleanSessionTitle("```\n## ignored\n```"), "ignored");
  assert.equal(cleanSessionTitle(`Title: ${"x".repeat(100)}`).length, 72);
  assert.equal(cleanSessionTitle("\n\n"), null);
});
