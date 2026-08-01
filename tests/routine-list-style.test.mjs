import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const component = readFileSync(new URL("../public/src/components/RoutineList.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("routine list owns its compact theme-aligned card and action styles", () => {
  assert.match(component, /<style>[\s\S]*\.routine-block\s*\{[^}]*var\(--border\)[^}]*var\(--panel-2\)/s);
  assert.match(component, /\.r-btn:hover:not\(:disabled\)[^{]*\{[^}]*var\(--surface-hover\)/s);
  assert.match(component, /\.r-btn\.warning\s*\{[^}]*var\(--yellow\)[^}]*color-mix/s);
  assert.match(component, /\.r-btn\.danger\s*\{[^}]*var\(--red\)[^}]*color-mix/s);
  assert.match(component, /\.r-btn\.warning:hover:not\(:disabled\)[^{]*\{[^}]*var\(--yellow\)/s);
  assert.match(component, /\.r-btn\.danger:hover:not\(:disabled\)[^{]*\{[^}]*var\(--red\)/s);
  assert.match(component, /\.r-btn:active:not\(:disabled\)\s*\{[^}]*translateY\(0\)/s);
  assert.doesNotMatch(globalStyles, /\.routine-block|\.r-btn|#routineList/);
  assert.match(globalStyles, /\.r-empty \{ color: var\(--muted\); font-size: 12px; flex-shrink: 0; \}/);
  assert.doesNotMatch(component, /html\[data-theme="light"\]|🧹|🗑/);
});

test("routine state is conveyed with visible labels and pending feedback", () => {
  assert.match(component, /<span class=\{`r-status \$\{dotClass\(routine\.status\)\}`\}>\{routine\.status\}<\/span>/);
  assert.match(component, /\.r-status\.stopping, \.r-status\.teardown\s*\{[^}]*var\(--yellow\)/s);
  assert.match(component, /\.r-status\.done\s*\{[^}]*var\(--green\)/s);
  assert.match(component, /\.r-status\.failed\s*\{[^}]*var\(--red\)/s);
  assert.match(component, /class={`r-dot \$\{dotClass\(routine\.status\)\}`} title=\{routine\.status\} aria-hidden="true"/);
  assert.match(component, /class="r-pending" role="status" aria-atomic="true"/);
  assert.match(component, /pendingLabel\(routine\)/);
  assert.match(component, /\.r-empty\.async-error\s*\{[^}]*var\(--red\)/s);
  assert.match(component, /\.r-btn:disabled\s*\{[^}]*cursor: not-allowed;[^}]*transform: none;/s);
});

test("routine controls wrap and provide mobile touch targets", () => {
  assert.match(component, /\.r-actions\s*\{[^}]*flex-wrap: wrap;/s);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*\.r-btn\s*\{[^}]*min-height: 40px;/s);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*flex: 1 1 calc\(50% - 3px\)/s);
});

test("RoutineList compiles without Svelte warnings", () => {
  const { warnings } = compile(component, { filename: "RoutineList.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
