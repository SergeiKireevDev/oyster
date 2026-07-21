import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageEntryMatchesElement,
  shouldShowThinking,
  summarizeToolArgs,
  toolResultText,
  userMessageText,
} from "../public/src/lib/messageUtils.js";

test("message utils: summarize tool args", () => {
  assert.equal(summarizeToolArgs("bash", { command: "npm test" }), "npm test");
  assert.equal(summarizeToolArgs("read", { path: "app.mjs" }), "app.mjs");
  assert.equal(summarizeToolArgs("edit", { file_path: "x.js" }), "x.js");
  assert.equal(summarizeToolArgs("custom", { other: "value" }), "value");
  assert.equal(summarizeToolArgs("custom", null), "");
});

test("message utils: extract tool result and user text", () => {
  assert.equal(toolResultText({ content: "plain" }), "plain");
  assert.equal(toolResultText({ content: [{ type: "text", text: "hello" }, { type: "image", mimeType: "image/png" }] }), "hello\n[image image/png]");
  assert.equal(userMessageText({ content: [{ type: "text", text: "hello" }, { type: "file" }] }), "hello\n[file]");
});

test("message utils: thinking visibility and entry matching", () => {
  assert.equal(shouldShowThinking({ getItem: () => "0" }), false);
  assert.equal(shouldShowThinking({ getItem: () => "1" }), true);
  const el = { dataset: { role: "assistant" }, textContent: "hello world from assistant" };
  assert.equal(messageEntryMatchesElement({ role: "assistant", text: "hello world" }, el), true);
  assert.equal(messageEntryMatchesElement({ role: "user", text: "hello world" }, el), false);
});
