import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const componentPath = new URL("../public/src/components/SettingsModal.svelte", import.meta.url);
const source = readFileSync(componentPath, "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("settings modal presents labelled, described preferences with native state", () => {
  assert.match(source, /class="settings-modal" role="group" aria-label="General preferences"/);
  assert.match(source, /class="m-option settings-option" class:active=\{option\.checked\}/);
  assert.match(source, /type="checkbox"[\s\S]*?aria-labelledby=\{`\$\{option\.id\}-label`\}[\s\S]*?aria-describedby=\{`\$\{option\.id\}-description`\}/);
  assert.match(source, /class="settings-description"[\s\S]*?\{option\.description\}/);
  assert.match(source, /Include model reasoning in the conversation transcript/);
  assert.match(source, /Use the brighter application theme on this device/);

  const { warnings } = compile(source, {
    filename: "SettingsModal.svelte",
    generate: false,
  });
  assert.deepEqual(warnings, []);
});

test("settings modal owns token-based selected, focus, disabled, and responsive styles", () => {
  const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  assert.match(style, /grid-template-columns:\s*18px minmax\(0, 1fr\)/);
  assert.match(style, /\.settings-option\.active\s*\{[\s\S]*?inset 2px 0 0 var\(--selection-marker\)/);
  assert.match(style, /:has\(\.settings-checkbox:focus-visible\)[\s\S]*?border-color:\s*var\(--accent\)/);
  assert.match(style, /:has\(\.settings-checkbox:disabled\)[\s\S]*?opacity:\s*\.45;[\s\S]*?cursor:\s*not-allowed/);
  assert.match(style, /accent-color:\s*var\(--accent\)/);
  assert.match(style, /\.settings-description\s*\{[\s\S]*?color:\s*var\(--muted\)/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px/);
  assert.match(style, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 100%/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
  assert.doesNotMatch(globalStyles, /#modal \.settings-(?:option|checkbox)/);
});

test("settings modal retains shared footer and primary completion action", () => {
  assert.match(source, /class="m-actions" id="mActions"/);
  assert.match(source, /class="btn" type="button" data-modal-cancel onclick=\{closeModalState\}>Done/);
});
