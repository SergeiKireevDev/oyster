import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/ChatLayout.svelte", import.meta.url),
  "utf8",
);

test("chat layout exposes semantic transcript structure and a native notice action", () => {
  assert.match(component, /<main id="chatcol">/);
  assert.match(component, /<section class="transcript-shell" aria-label="Conversation transcript">/);
  assert.match(component, /id="transcriptNotice"[\s\S]*type="button"[\s\S]*aria-label="Scroll to newest transcript event"/);
  assert.match(component, /<span aria-hidden="true">↓<\/span>/);
});

test("chat layout names its scroll threshold and safely releases scheduled work", () => {
  assert.match(component, /const NOTICE_CLEARANCE_PX = 120;/);
  assert.match(component, /function isNearNewest\(node\)/);
  assert.match(component, /if \(!scroller\) return;/);
  assert.match(component, /onDestroy\(\(\) => scrollTracking\.cancel\(\)\);/);
  assert.doesNotMatch(component, /onDestroy\(scrollTracking\.cancel\)/);
});
