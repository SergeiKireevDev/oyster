import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(
  new URL(`../public/src/components/${name}`, import.meta.url),
  "utf8",
);

const chatLayout = component("ChatLayout.svelte");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("chat layout exposes semantic transcript structure and a native notice action", () => {
  assert.match(chatLayout, /<main id="chatcol">/);
  assert.match(chatLayout, /<section class="transcript-shell" aria-label="Conversation transcript">/);
  assert.match(chatLayout, /id="transcriptNotice"[\s\S]*type="button"[\s\S]*aria-label="Scroll to newest transcript event"/);
  assert.match(chatLayout, /<span aria-hidden="true">↓<\/span>/);
});

test("chat layout keeps its structural and transcript canvas styling scoped", () => {
  assert.match(chatLayout, /#main\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;/);
  assert.match(chatLayout, /#chatcol\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?background:\s*color-mix\(in srgb, var\(--bg\) 48%, transparent\)/);
  assert.match(chatLayout, /#scroller\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;[\s\S]*?var\(--accent\)/);
  assert.doesNotMatch(chatLayout, /scroll-behavior:\s*smooth/);
  assert.doesNotMatch(globalStyles, /#(?:main|chatcol|scroller|transcriptNotice)\b|\.transcript-shell\b/);
});

test("new transcript notice follows shared interaction and responsive contracts", () => {
  assert.match(chatLayout, /#transcriptNotice\s*\{[\s\S]*?border:\s*1px solid color-mix\([\s\S]*?background:\s*var\(--panel-2\);[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(chatLayout, /#transcriptNotice:hover\s*\{[\s\S]*?border-color:\s*var\(--accent\);[\s\S]*?background:\s*var\(--accent-dim\)/);
  assert.match(chatLayout, /@media \(max-width: 760px\)[\s\S]*?#transcriptNotice\s*\{[\s\S]*?width:\s*var\(--icon-control-standard\);[\s\S]*?height:\s*var\(--icon-control-standard\);/);
  assert.match(chatLayout, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none/);
  assert.match(chatLayout, /box-shadow:\s*0 10px 28px color-mix\(in srgb, var\(--muted\) 22%, transparent\)/);
  assert.doesNotMatch(chatLayout, /:global\(/);
});

test("chat layout names its scroll threshold and safely releases scheduled work", () => {
  assert.match(chatLayout, /const NOTICE_CLEARANCE_PX = 120;/);
  assert.match(chatLayout, /const HISTORY_LOAD_THRESHOLD_PX = 480;/);
  assert.match(chatLayout, /node\.scrollTop <= HISTORY_LOAD_THRESHOLD_PX[\s\S]*?TRANSCRIPT_LOAD_EARLIER_ACTION/);
  assert.match(chatLayout, /function isNearNewest\(node\)/);
  assert.match(chatLayout, /if \(!scroller\) return;/);
  assert.match(chatLayout, /onDestroy\(\(\) => scrollTracking\.cancel\(\)\);/);
  assert.doesNotMatch(chatLayout, /onDestroy\(scrollTracking\.cancel\)/);
});

test("auxiliary sidebars stay unwrapped as direct chat layout flex children", () => {
  const source = component("Sidebars.svelte");
  const markup = source.replace(/<script>[\s\S]*?<\/script>/, "");

  assert.match(chatLayout, /<Sidebars \/>/);
  assert.match(markup, /<HublotSidebar \/>/);
  assert.doesNotMatch(markup, /CheckpointTreebar/);
  assert.doesNotMatch(markup, /<(?:aside|div|section)\b/);
});
