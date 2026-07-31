import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const componentsRoot = new URL("../public/src/components/", import.meta.url);

function componentSources(directory = componentsRoot, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return componentSources(path, `${prefix}${entry.name}/`);
    return entry.name.endsWith(".svelte")
      ? [[`${prefix}${entry.name}`, readFileSync(path, "utf8")]]
      : [];
  });
}

test("activation behavior is implemented with native interactive elements", () => {
  const violations = [];
  const nonInteractiveTag = /<(div|span|section|article|li|img)\b[^>]*>/gs;

  for (const [file, source] of componentSources()) {
    for (const match of source.matchAll(nonInteractiveTag)) {
      const tag = match[0];
      if (/\brole\s*=\s*["']button["']/.test(tag)) {
        violations.push(`${file} uses role=button on <${match[1]}>`);
        continue;
      }

      const activation = tag.match(/\bon(?:click|mousedown|mouseup)\s*=\s*\{([^}]*)\}/s);
      if (activation && !activation[1].includes("stopPropagation")) {
        violations.push(`${file} attaches ${activation[0].split("=")[0].trim()} to <${match[1]}>`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("command choices and actionable toasts retain native button semantics", () => {
  const commandPalette = readFileSync(new URL("CommandPalette.svelte", componentsRoot), "utf8");
  const toast = readFileSync(new URL("ToastItem.svelte", componentsRoot), "utf8");

  assert.match(commandPalette, /<button\s+type="button"[\s\S]*?class="cmd-row"/);
  assert.doesNotMatch(commandPalette, /<div[^>]*class="cmd-row"/);
  assert.match(toast, /\{#if toast\.onClick\}[\s\S]*?<button\s+type="button"/);
  assert.doesNotMatch(toast, /svelte-ignore\s+a11y_no_noninteractive_tabindex|role=\{toast\.onClick/);
});
