import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(
  new URL(`../public/src/components/${name}`, import.meta.url),
  "utf8",
);

const chatLayout = component("ChatLayout.svelte");

test("chat layout exposes semantic transcript structure and a native notice action", () => {
  assert.match(chatLayout, /<main id="chatcol">/);
  assert.match(chatLayout, /<section class="transcript-shell" aria-label="Conversation transcript">/);
  assert.match(chatLayout, /id="transcriptNotice"[\s\S]*type="button"[\s\S]*aria-label="Scroll to newest transcript event"/);
  assert.match(chatLayout, /<span aria-hidden="true">↓<\/span>/);
});

test("chat layout names its scroll threshold and safely releases scheduled work", () => {
  assert.match(chatLayout, /const NOTICE_CLEARANCE_PX = 120;/);
  assert.match(chatLayout, /function isNearNewest\(node\)/);
  assert.match(chatLayout, /if \(!scroller\) return;/);
  assert.match(chatLayout, /onDestroy\(\(\) => scrollTracking\.cancel\(\)\);/);
  assert.doesNotMatch(chatLayout, /onDestroy\(scrollTracking\.cancel\)/);
});

test("auxiliary sidebars stay unwrapped as direct chat layout flex children", () => {
  const source = component("Sidebars.svelte");
  const markup = source.replace(/<script>[\s\S]*?<\/script>/, "");

  assert.match(chatLayout, /<Sidebars \/>/);
  assert.match(markup, /<HublotSidebar \/>\s*<CheckpointTreebar \/>/);
  assert.doesNotMatch(markup, /<(?:aside|div|section)\b/);
});
