import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("session lists render an accessible harness pill for saved, live, loop, and search entries", () => {
  const sidebar = component("SessionSidebar.svelte");
  const modal = component("SessionPickerModal.svelte");
  const pill = component("HarnessPill.svelte");

  assert.match(sidebar, /function sessionHarness\(session, runner\)[\s\S]*?runner\?\.harness \|\| session\?\.harness \|\| "pi"/);
  assert.equal((sidebar.match(/<HarnessPill /g) ?? []).length, 3);
  assert.equal((modal.match(/<HarnessPill /g) ?? []).length, 3);
  assert.match(pill, /data-harness=\{harnessId\}/);
  assert.match(pill, /aria-label=\{`Harness: \$\{label\}`\}/);
  assert.match(pill, /"claude-code": "Claude Code"/);
  assert.match(pill, /codex: "Codex"/);
  assert.match(pill, /gemini: "Gemini CLI"/);
  assert.match(pill, /amp: "Amp"/);
  assert.match(pill, /border-radius: 999px/);
  assert.match(pill, /title=\{`Harness: \$\{label\}`\}/);
  assert.match(pill, /<svg[^>]*aria-hidden="true"/);
  for (const id of ["pi", "claude-code", "codex", "gemini", "amp"]) {
    assert.ok(pill.includes(`harnessId === "${id}"`), `${id} has a distinct monochrome mark`);
  }
  assert.match(pill, /class="harness-name">\{label\}/);
  assert.match(pill, /label\.slice\(0, 1\)\.toUpperCase\(\)/);
  assert.doesNotMatch(pill, /var\(--accent\)/);

  for (const name of ["HarnessPill.svelte", "SessionSidebar.svelte", "SessionPickerModal.svelte"]) {
    const { warnings } = compile(component(name), { filename: name, generate: false });
    assert.deepEqual(warnings, []);
  }
});
