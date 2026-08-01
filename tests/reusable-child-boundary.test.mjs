import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (path) => readFileSync(new URL(`../public/src/components/${path}`, import.meta.url), "utf8");

// These are reusable presentation children. Feature views such as Transcript,
// Toasts, and Overlays own subscriptions and adapt their state into focused props.
const presentationChildren = [
  "CarouselIndicator.svelte",
  "ToastItem.svelte",
  "transcript/UserMessage.svelte",
  "transcript/AssistantMessage.svelte",
];

test("reusable presentation children do not import global feature stores or actions", () => {
  for (const path of presentationChildren) {
    const source = component(path);
    assert.doesNotMatch(source, /from ["'][^"']*\/stores\//, path);
    assert.doesNotMatch(source, /getUiActionRegistry|uiActions\.invoke/, path);
  }
});

test("feature owners adapt global state into focused child props", () => {
  const overlays = component("Overlays.svelte");
  assert.match(overlays, /<CarouselIndicator page=\{\$carouselPage\} \/>/);

  const toasts = component("Toasts.svelte");
  assert.match(toasts, /<ToastItem \{toast\} onDismiss=\{removeToast\} \/>/);
  assert.match(component("ToastItem.svelte"), /let \{ toast, onDismiss = \(\) => \{\} \} = \$props\(\)/);

  const transcript = component("Transcript.svelte");
  assert.doesNotMatch(transcript, /checkpointMarker|onCheckpoint/);
  assert.equal((transcript.match(/restores=\{\$checkpointRestores\}/g) ?? []).length, 2);

  for (const path of ["transcript/UserMessage.svelte", "transcript/AssistantMessage.svelte"]) {
    const source = component(path);
    assert.doesNotMatch(source, /onCheckpoint|CheckpointButton/, path);
    assert.match(source, /restores = \[\]/, path);
  }
});
