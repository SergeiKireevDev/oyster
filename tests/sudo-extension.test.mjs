import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/sudo.ts", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../public/src/components/TextPromptModal.svelte", import.meta.url), "utf8");

test("sudo extension requests a masked RPC prompt when bash sudo is explicitly enabled", () => {
  assert.match(source, /sudo: Type\.Optional\(Type\.Boolean/);
  assert.match(source, /const sudo = \(event\.input as \{ sudo\?: unknown \}\)\.sudo === true/);
  assert.match(source, /const command = String\(\(event\.input as \{ command\?: unknown \}\)\.command \?\? ""\)/);
  assert.match(source, /ctx\.ui\.input\(`Sudo password required for: \$\{command\}`, "Password", \{[\s\S]*secret: true/);
  assert.match(source, /requestPassword\(ctx, command\)/);
  assert.match(source, /requestPassword\(ctx, event\.command\)/);
  assert.match(source, /pendingPasswords\.set\(event\.toolCallId, password\)/);
  assert.match(prompt, /sudoTitlePrefix = "Sudo password required for: "/);
  assert.match(prompt, /\{#if sudoCommand\}[\s\S]*?<span>Command<\/span>[\s\S]*?<code>\{sudoCommand\}<\/code>/);
  assert.match(prompt, /type=\{inputType\}/);
  assert.match(prompt, /current-password/);
});

test("sudo password is supplied on stdin and excluded from command and environment", () => {
  assert.match(source, /local\.exec\(authorizedCommand, cwd, \{ \.\.\.options, stdin: `\$\{password\}\\n` \}\)/);
  assert.match(source, /sudo -S -p '' -- \/bin\/bash -c/);
  assert.doesNotMatch(source, /env:\s*\{[^}]*password/is);
  assert.equal((source.match(/`\$\{password\}\\n`/g) ?? []).length, 1);
  assert.match(source, /pendingPasswords\.delete\(id\)/);
});

test("the complete command is elevated only when sudo is true", () => {
  assert.match(source, /if \(params\.sudo !== true\) \{[\s\S]*return baseBash\.execute/);
  assert.match(source, /operationsWithPassword\(password, \{ elevateEntireCommand: true \}\)/);
  assert.match(source, /do not include sudo in the command/);
});

test("sudo commands are blocked when a password prompt is unavailable or cancelled", () => {
  assert.match(source, /if \(!ctx\.hasUI\) return undefined/);
  assert.match(source, /block: true, reason: "Sudo command cancelled/);
  assert.match(source, /Sudo command blocked because no password was authorized/);
});
