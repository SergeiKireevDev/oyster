import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/CredentialsModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("credentials modal owns its component-specific visual contract", () => {
  assert.match(component, /<style>[\s\S]*?\.api-keys-modal\s*\{/);
  assert.doesNotMatch(globalStyles, /\.api-keys-(?:modal|intro|state)|\.api-key-(?:row|form|oauth|remove)|\.oauth-flow/);
  assert.doesNotMatch(component, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.match(component, /background:\s*color-mix\([\s\S]*?var\(--panel\)/);
});

test("credentials actions reuse shared roles and expose operation state", () => {
  assert.match(component, /class="api-keys-modal"[^>]*aria-busy=\{\$credentialsState\.loading \|\| oauthOperationPending\}/);
  assert.match(component, /class="chip api-key-oauth"/);
  assert.match(component, /class="chip api-key-remove"/);
  assert.match(component, /class="chip oauth-device-code-copy"[^>]*aria-live="polite"/);
  assert.match(component, /class="chip oauth-choice"/);
  assert.match(component, /class="chip oauth-cancel"/);
  assert.match(component, /\.api-keys-modal \.chip:disabled\s*\{[^}]*opacity:\s*\.45;[^}]*cursor:\s*default;[^}]*transform:\s*none;/);
});

test("credentials states use semantic, non-color-only treatments", () => {
  assert.match(component, /class="oauth-result success" role="status"/);
  assert.match(component, /class="oauth-result warning" role="status"/);
  assert.match(component, /\.oauth-result\s*\{[^}]*border:\s*1px solid currentColor;[^}]*font-weight:/);
  assert.match(component, /\.oauth-result\.success\s*\{[^}]*var\(--green\)/);
  assert.match(component, /\.oauth-result\.warning\s*\{[^}]*var\(--yellow\)/);
  assert.match(component, /\.api-keys-state\.error\s*\{[\s\S]*?var\(--red\)/);
});

test("credentials layout handles narrow screens, touch, and long values", () => {
  assert.match(component, /\.api-key-provider strong\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(component, /overflow-wrap:\s*anywhere;/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(component, /@media \(max-width: 600px\)[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*?flex-direction:\s*column;/);
});
