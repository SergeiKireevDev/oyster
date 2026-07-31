import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { addToast, removeToast, toasts } from "../public/src/stores/toasts.js";

function clearToasts() {
  for (const toast of get(toasts)) removeToast(toast.id);
}

test("deduplicated toasts allow only one active toast per key", () => {
  clearToasts();
  const first = addToast("UI updated — tap to refresh", "warning", { sticky: true, dedupeKey: "ui_reload" });
  const duplicate = addToast("UI updated — tap to refresh", "warning", { sticky: true, dedupeKey: "ui_reload" });

  assert.equal(duplicate, first);
  assert.equal(get(toasts).length, 1);

  removeToast(first);
  const replacement = addToast("UI updated — tap to refresh", "warning", { sticky: true, dedupeKey: "ui_reload" });
  assert.notEqual(replacement, first);
  assert.equal(get(toasts).length, 1);
  clearToasts();
});
