import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/CloudWorkspaceModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("cloud workspace provisioning owns a token-based responsive visual contract", () => {
  assert.match(component, /<style>[\s\S]*?\.cloud-workspace-modal\s*\{/);
  assert.match(component, /\.cloud-provider-card:hover:not\(:disabled\)/);
  assert.match(component, /\.cloud-provider-card:disabled\s*\{[\s\S]*?opacity:\s*\.45;[\s\S]*?cursor:\s*not-allowed;/);
  assert.match(component, /\.cloud-method-list button\.active\s*\{[\s\S]*?var\(--selection-bg\)[\s\S]*?var\(--selection-text\)/);
  assert.match(component, /\.cloud-error\s*\{[\s\S]*?var\(--red\)/);
  assert.match(component, /\.cloud-success-icon\s*\{[\s\S]*?var\(--green\)/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(component, /@media \(max-width: 600px\)[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(component, /@media \(max-width: 520px\)/);
});

test("cloud workspace provisioning reuses shared controls and exposes state semantics", () => {
  assert.equal((component.match(/class="chip cloud-back"/g) ?? []).length, 3);
  assert.match(component, /class="chip cloud-manage-credentials"/);
  assert.match(component, /aria-current=\{step === "providers" \? "step" : undefined\}/);
  assert.match(component, /aria-describedby=\{error \? "cloudWorkspaceError" : undefined\}/);
  assert.match(component, /id="cloudWorkspaceError"[^>]*role="alert"[^>]*aria-atomic="true"/);
  assert.match(component, /class:active=\{selectedMethod\?\.id === method\.id\} aria-pressed=/);
});

test("cloud workspace styles are consolidated out of the global stylesheet", () => {
  for (const selector of [".cloud-workspace-modal", ".cloud-provider-card", ".cloud-form", ".cloud-success"]) {
    assert.doesNotMatch(globalStyles, new RegExp(`\\${selector}\\s*\\{`));
  }
});
