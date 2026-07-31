import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/components/Composer.svelte", import.meta.url), "utf8");

test("composer component routes input, keydown, send, and abort through scoped actions", () => {
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_INPUT_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_KEYDOWN_ACTION, event\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_SEND_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_ABORT_ACTION\)/);
  assert.doesNotMatch(source, /features\/composer\/composerActions\.js/);
  assert.doesNotMatch(source, /usageInfo/);
});

test("composer exposes named message, voice, and stop controls", () => {
  assert.match(source, /<form class="inner" onsubmit=\{handleSubmit\} aria-label="Message composer">/);
  assert.match(source, /id="input"[\s\S]*?enterkeyhint="send"/);
  assert.match(source, /id="voiceBtn"[\s\S]*?disabled=\{voiceButtonDisabled\}[\s\S]*?aria-controls="input"/);
  assert.match(source, /id="stopBtn"[^>]*disabled=\{aborting\}[^>]*aria-label="Stop agent"/);
});

test("composer reuses highlight nodes and always gives transcription a useful tooltip", () => {
  assert.match(source, /voice\.status \|\| "Transcribing voice input"/);
  assert.match(source, /voiceButtonDisabled = \$composerVoice\.transcribing \|\| voiceIsStarting\(\$composerVoice\)/);
  assert.match(source, /if \(aborting\) return;[\s\S]*await uiActions\.invoke\(COMPOSER_ABORT_ACTION\)/);
  assert.match(source, /\{#each highlightSegments as segment, index \(highlightSegmentKey\(segment, index\)\)\}/);
  assert.doesNotMatch(source, /\{#each highlightSegments as segment \(segment\)\}/);
});
