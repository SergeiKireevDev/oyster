import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const sourceRoot = new URL("../public/src/", import.meta.url);

function svelteFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

const runeApi = /\$(?:state|derived|effect|props|bindable|inspect|host)\b/;
const legacyReactiveApis = [
  { name: "reactive statement", pattern: /(^|\n)\s*\$:/ },
  { name: "legacy prop", pattern: /\bexport\s+let\b/ },
  { name: "legacy lifecycle hook", pattern: /\b(?:beforeUpdate|afterUpdate)\s*\(/ },
  { name: "legacy event dispatcher", pattern: /\bcreateEventDispatcher\s*\(/ },
  { name: "legacy component metadata", pattern: /\$\$(?:props|restProps|slots)\b/ },
];

// Migration boundary: Svelte mode is selected per component. Stores and onMount/onDestroy
// work in both modes, but a component that adopts a rune must not retain legacy-only
// reactive APIs; migrate that component atomically instead.
test("each Svelte component stays entirely on one side of the runes migration boundary", () => {
  const modes = { runes: [], legacy: [] };

  for (const file of svelteFiles()) {
    const source = readFileSync(file, "utf8");
    const location = relative(sourceRoot.pathname, file.pathname);
    const usesRunes = runeApi.test(source);
    const legacyMatches = legacyReactiveApis.filter(({ pattern }) => pattern.test(source));

    if (usesRunes) {
      modes.runes.push(location);
      assert.deepEqual(
        legacyMatches.map(({ name }) => name),
        [],
        `${location} mixes runes with ${legacyMatches.map(({ name }) => name).join(", ")}`,
      );
    } else {
      modes.legacy.push(location);
    }
  }

  assert.ok(modes.runes.length > 0, "expected migrated rune components to audit");
  assert.ok(modes.legacy.length > 0, "expected the per-component legacy migration boundary to remain explicit");
});
