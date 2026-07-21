import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../public/src/components/${path}`, import.meta.url), "utf8");

test("checkpoint model picker owns its footer actions", () => {
  const component = read("CheckpointModelPickerModal.svelte");
  const overlays = read("Overlays.svelte");

  assert.match(component, /class="m-actions"/);
  assert.match(component, /onclick=\{cancelCheckpointModelPicker\}/);
  assert.match(component, /onclick=\{submitCheckpointModelPicker\}/);
  assert.doesNotMatch(overlays, /cancelCheckpointModelPicker|submitCheckpointModelPicker|\$checkpointModelPicker/);
});
