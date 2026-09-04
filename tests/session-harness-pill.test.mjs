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
  assert.match(pill, /border-radius: 999px/);

  for (const name of ["HarnessPill.svelte", "SessionSidebar.svelte", "SessionPickerModal.svelte"]) {
    const { warnings } = compile(component(name), { filename: name, generate: false });
    assert.deepEqual(warnings, []);
  }
});
