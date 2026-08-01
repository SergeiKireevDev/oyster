import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const componentPath = new URL("../public/src/components/SessionSidebar.svelte", import.meta.url);
const source = readFileSync(componentPath, "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("session sidebar owns its calm responsive presentation", () => {
  assert.match(source, /<style>[\s\S]*?#sessions \{[\s\S]*?var\(--sidebar-width\)/);
  assert.match(source, /\.session-sidebar-search:focus-visible \{[\s\S]*?var\(--accent\)/);
  assert.match(source, /\.session-sidebar-workspace-container\.current-workspace \{ border-color: color-mix\(in srgb, var\(--accent\) 14%, var\(--border\)\); \}/);
  assert.doesNotMatch(source, /\.current-workspace > \.session-sidebar-workspace-heading \{[^}]*background/);
  assert.match(source, /\.session-sidebar-cwd\.current-cwd > summary \{ background: color-mix\(in srgb, var\(--accent\) 3%, transparent\)/);
  assert.match(source, /\.session-sidebar-cwd\[open\] > \.session-sidebar-workspace-sessions \{ padding-top: 4px; \}/);
  assert.match(source, /\.session-sidebar-entry\.current \{[\s\S]*?var\(--accent\) 4%, var\(--panel-2\)[\s\S]*?box-shadow: inset 1px 0 0 var\(--selection-marker\)/);
  for (const token of ["selection-bg", "selection-border", "selection-marker", "selection-text"]) {
    assert.match(globalStyles, new RegExp(`--${token}:`));
  }
  assert.match(globalStyles, /#modal \.m-option\.active,[\s\S]*?var\(--selection-bg\)[\s\S]*?var\(--selection-marker\)/);
  assert.doesNotMatch(globalStyles, /#modal \.m-option\.current \{[^}]*(?:var\(--user-bubble\)|0 0 12px)/);
  assert.match(source, /\.session-sidebar-workspace-power:disabled,[\s\S]*?cursor: not-allowed/);
  assert.match(source, /\.session-sidebar-instance-status\.status-online,[\s\S]*?var\(--green\)/);
  assert.match(source, /\.session-sidebar-instance-status:is\(\.status-failed, \.status-destroying\)[\s\S]*?var\(--red\)/);
  assert.match(source, /\.session-sidebar-action\.stop::before \{ width: 11px; height: 11px;/);
  assert.match(source, /\.session-sidebar-action\.delete::before \{ width: 11px; height: 11px;/);
  assert.match(source, /\.session-sidebar-lifecycle\.archive::before \{ width: 11px; height: 11px;/);
  assert.match(source, /@media \(max-width: 760px\) \{[\s\S]*?\.session-sidebar-action,\s*\.session-sidebar-lifecycle \{ width: var\(--icon-control-standard\); height: var\(--icon-control-standard\); \}/);
  assert.doesNotMatch(source, /@media \(max-width: 760px\) \{[\s\S]*?\.session-sidebar-workspace-(?:power|destroy|create)[^}]*icon-control-important/);
  assert.doesNotMatch(source, /\.session-sidebar-workspace-heading \{ flex-wrap: wrap; \}/);
  assert.match(source, /@media \(max-width: 520px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(source, /@media \(pointer: coarse\) \{[\s\S]*?\.session-sidebar-workspace-power::after,[\s\S]*?inset: -8px -6px/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);

  assert.doesNotMatch(globalStyles, /\.session-sidebar|\.session-loop|\.session-timeline|\.session-archive/);
});

test("session sidebar retains explicit state and control semantics", () => {
  assert.match(source, /<aside id="sessions" aria-label="Sessions">/);
  assert.match(source, /type="search"[\s\S]*?aria-label="Search sessions"[\s\S]*?aria-busy=\{\$sessionPicker\.searching\}/);
  assert.match(source, /class="session-sidebar-status" role="status" aria-atomic="true"/);
  assert.match(source, /role="img"[\s\S]*?aria-label=\{`Workspace status:/);
  assert.match(source, /class="session-timeline-marker" role="img" aria-label=\{loopStatusLabel\(timelineStatus\)\}/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /disabled=\{managing \|\| !\["online", "paused"\]\.includes\(status\)\}/);

  const { warnings } = compile(source, {
    filename: "SessionSidebar.svelte",
    generate: false,
  });
  assert.deepEqual(warnings, []);
});
