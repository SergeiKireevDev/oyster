import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("monitoring output has explicit high-contrast light-theme colors", () => {
  assert.match(styles, /html\[data-theme="light"\] \.pinned-widget-viewer-stage\.monitoring-stage \{ background: #fff; \}/);
  assert.match(styles, /html\[data-theme="light"\] \.pinned-monitor-output \{ color: #1f2937; \}/);
  assert.match(styles, /html\[data-theme="light"\] \.diff-line\.diff-added \{ background: #ecfdf3; color: #176534; \}/);
  assert.match(styles, /html\[data-theme="light"\] \.diff-line\.diff-removed \{ background: #fff0f1; color: #a61b2b; \}/);
});
