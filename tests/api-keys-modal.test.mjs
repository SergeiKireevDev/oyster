import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../public/src/components/ApiKeysModal.svelte", import.meta.url), "utf8");
const overlays = readFileSync(new URL("../public/src/components/Overlays.svelte", import.meta.url), "utf8");
const store = readFileSync(new URL("../public/src/stores/apiKeys.js", import.meta.url), "utf8");

test("API Keys modal is owned by the overlay and covers safe provider states", () => {
  assert.match(overlays, /import ApiKeysModal from "\.\/ApiKeysModal\.svelte"/);
  assert.match(overlays, /\$modalState\.content === "apiKeys"[\s\S]*?<ApiKeysModal/);
  for (const label of ["stored API key", "stored OAuth", "environment", "models.json", "not configured"]) {
    assert.ok(modal.includes(label), `missing source label: ${label}`);
  }
  assert.match(modal, /provider\.credentialType === "oauth"[\s\S]*?Read-only/);
});

test("API Keys modal renders loading empty error and restart feedback without credential fields", () => {
  assert.match(modal, /Loading provider credentials/);
  assert.match(modal, /No providers are available/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /Restart status:/);
  assert.doesNotMatch(modal, /provider\.(?:key|token|access|refresh|secret)/);
  assert.doesNotMatch(store, /\b(?:key|token|secret)\s*:/i);
});
