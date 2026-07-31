import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function svelteSources(dir = new URL("../public/src/", import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory()
      ? svelteSources(child)
      : entry.name.endsWith(".svelte") ? [[child.pathname, readFileSync(child, "utf8")]] : [];
  });
}

test("component styles do not escape Svelte scoping with :global selectors", () => {
  for (const [path, source] of svelteSources()) {
    assert.doesNotMatch(source, /:global\s*\(/, path);
  }
});

test("components use classes instead of static inline layout styles", () => {
  for (const [path, source] of svelteSources()) {
    assert.doesNotMatch(source, /\bstyle\s*=\s*["'][^"'{]*["']/, path);
  }

  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(styles, /\.modal-primary-action\s*\{/);
  assert.match(styles, /\.modal-code-editor\s*\{/);
  assert.match(styles, /\.file-explorer-row\s*\{/);
});

test("runtime-dependent geometry uses named style state rather than static declarations", () => {
  const routines = readFileSync(new URL("../public/src/components/RoutineList.svelte", import.meta.url), "utf8");
  const touchGrid = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");

  assert.match(routines, /style:width=\{progressWidth\(routine\)\}/);
  assert.match(touchGrid, /style=\{`left:\$\{touchPreview\.x\}px;top:\$\{touchPreview\.y\}px;`\}/);
});

test("image artifact viewers share their common frame and media styles", () => {
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(styles, /\.pinned-image-frame,\s*\.pinned-svg-stage\s*\{[^}]*display: grid;[^}]*place-items: center;[^}]*overflow: auto;/);
  assert.match(styles, /\.pinned-image-frame img,\s*\.pinned-svg-stage img\s*\{[^}]*max-width: 100%;[^}]*object-fit: contain;/);
});

test("Header owns its layout and presentation styles", () => {
  const header = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(header, /<header class="app-header">/);
  assert.match(header, /<style>[\s\S]*?\.app-header\s*\{/);
  assert.doesNotMatch(styles, /\.app-header|\.brand-mark|\.header-actions|\.header-status|\.header-action-divider/);
  assert.doesNotMatch(selectors, /^[\t ]*(?:html[^\n{]*[\t ]+)?header(?:[\t ]|\{|[.:#\[])/m);
});
