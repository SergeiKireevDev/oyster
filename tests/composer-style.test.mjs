import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/Composer.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("composer owns its token-based floating surface and editor presentation", () => {
  assert.match(component, /<style>[\s\S]*?#composer\s*\{[\s\S]*?var\(--bg\)/);
  assert.match(component, /\.inner\s*\{[\s\S]*?border-radius:\s*17px;[\s\S]*?var\(--panel-2\)/);
  assert.match(component, /\.inner:focus-within\s*\{[\s\S]*?var\(--accent\)/);
  assert.match(component, /#input::placeholder\s*\{[\s\S]*?var\(--muted\)/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("composer distinguishes voice, loading, disabled, and aborting states", () => {
  assert.match(component, /class:starting=\{voiceStarting\}/);
  assert.match(component, /aria-busy=\{voiceButtonDisabled\}/);
  assert.match(component, /\{#if voiceButtonDisabled\}[\s\S]*?class="voice-loading"/);
  assert.match(component, /\.voice-btn\.recording\s*\{[\s\S]*?var\(--red\)/);
  assert.match(component, /\.voice-btn:is\(\.transcribing, \.starting\)\s*\{[\s\S]*?var\(--accent\)/);
  assert.match(component, /aria-busy=\{aborting\}[\s\S]*?\{aborting \? "Stopping…" : "Stop"\}/);
  assert.match(component, /#input:disabled\s*\{[\s\S]*?cursor:\s*not-allowed/);
});

test("composer handles narrow screens, long status content, and mobile touch targets", () => {
  assert.match(component, /#workdirInfo\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(component, /#voiceStatus\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?\.composer-prompt\s*\{[\s\S]*?display:\s*none/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*?\.voice-btn\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px/);
});

test("composer-specific presentation is consolidated out of the global stylesheet", () => {
  for (const selector of ["#composer", "#input", ".composer-prompt", ".composer-highlight", ".voice-btn", "#statusbar", "#workdirInfo"]) {
    assert.doesNotMatch(globalStyles, new RegExp(`\\${selector}(?:[\\s.{:#]|$)`));
  }
});
