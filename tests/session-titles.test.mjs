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
  process.emit("close", 0);

  assert.equal(await result, "Fix OAuth Redirect Handling");
  assert.equal(spawned, process);
  assert.equal(calls[0].options.cwd, "/workspace");
  assert.ok(calls[0].args.includes("anthropic/claude-sonnet"));
  assert.ok(calls[0].args.includes("--no-tools"));
  assert.ok(calls[0].args.includes("--no-context-files"));
  assert.equal(calls[0].args.at(-2), "-p");
  assert.match(calls[0].args.at(-1), /Fix OAuth redirects/);
});

test("session title cleanup strips formatting, controls, and bounds output", () => {
  assert.equal(cleanSessionTitle("```\n## ignored\n```"), "ignored");
  assert.equal(cleanSessionTitle('Title: "Fix\u0000 OAuth\u001b"'), "Fix OAuth");
  assert.equal(cleanSessionTitle(`Title: ${"x".repeat(100)}`).length, 72);
  assert.equal(cleanSessionTitle("\n\n"), null);
});

test("session title context tolerates malformed structured values", () => {
  const circular = {};
  circular.self = circular;
  const transcript = firstSessionMessages([{ role: "assistant", content: [
    { type: "text", text: { nested: true } },
    { type: "text", text: Symbol("description") },
    { type: "toolCall", name: "", arguments: circular },
  ] }]);

  assert.match(transcript, /\{"nested":true\}/);
  assert.match(transcript, /Symbol\(description\)/);
  assert.match(transcript, /tool call: unknown \{"self":"\[circular\]"\}/);
});

test("session title context bounds sparse and recursively nested content", () => {
  const blocks = [];
  blocks.length = 1_000_000_000;
  blocks[0] = { type: "toolResult" };
  blocks[0].content = blocks;

  const transcript = firstSessionMessages([{ role: "assistant", content: blocks }]);

  assert.match(transcript, /tool result: \[circular content\]/);
  assert.ok(transcript.length <= 3_050);
});

test("session title context tolerates throwing message accessors", () => {
  const message = {};
  Object.defineProperties(message, {
    role: { get() { throw new Error("unreadable role"); } },
    content: { get() { throw new Error("unreadable content"); } },
  });

  assert.equal(firstSessionMessages([message]), "1. unknown: [no text]");
});

test("session title summarizer returns null and kills the child when spawn registration fails", async (t) => {
  t.mock.method(console, "error", () => {});
  const process = fakeProcess();
  const result = summarizeSessionTitle({ ephemeral: () => process }, {
    cwd: "/workspace",
    messages: [{ role: "user", content: "Review the server" }],
    onSpawn: () => { throw new Error("registration failed"); },
  });

  assert.equal(await result, null);
  assert.equal(process.signal, "SIGKILL");
});

test("session title summarizer ignores malformed model and callback configuration", async () => {
  const process = fakeProcess();
  const model = {};
  Object.defineProperty(model, "provider", { get() { throw new Error("unreadable provider"); } });
  const result = summarizeSessionTitle({ ephemeral: () => process }, {
    cwd: "/workspace",
    messages: [{ role: "user", content: "Review the server" }],
    model,
    onSpawn: "not a function",
  });
  process.stdout.end("Review Server Code");
  process.emit("close", 0);

  assert.equal(await result, "Review Server Code");
});

test("session title summarizer converts synchronous spawn failures to null", async (t) => {
  t.mock.method(console, "error", () => {});
  const result = summarizeSessionTitle({ ephemeral: () => { throw new Error("spawn failed"); } }, {
    cwd: "/workspace",
    messages: [{ role: "user", content: "Review the server" }],
  });

  assert.equal(await result, null);
});

test("session title summarizer kills a child that exceeds its timeout", async () => {
  const process = fakeProcess();
  const result = summarizeSessionTitle({ ephemeral: () => process }, {
    cwd: "/workspace",
    messages: [{ role: "user", content: "Review the server" }],
    timeoutMs: 0,
  });

  // A real child keeps the event loop alive; this fake needs an equivalent handle.
  const keepAlive = setTimeout(() => {}, 100);
  assert.equal(await result, null);
  clearTimeout(keepAlive);
  assert.equal(process.signal, "SIGKILL");
});
