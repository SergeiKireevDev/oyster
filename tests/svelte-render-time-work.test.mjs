import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildPinnedWidgetViewModel } from "../public/src/features/pinned-widgets/pinnedWidgetViewModel.js";
import { prepareSessionEntryFamilies, prepareSessionFamilies } from "../public/src/features/sessions/sessionPickerViewModel.js";

const componentsRoot = new URL("../public/src/components/", import.meta.url);
const componentFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? componentFiles(path) : entry.name.endsWith(".svelte") ? [path] : [];
});

test("pinned widget collections are indexed and sorted once outside render snippets", () => {
  const widgets = [
    { id: "later", label: "Later", scope: "session", groupId: null, kind: "file", position: 2 },
    { id: "builtin", label: "Files", scope: "session", groupId: null, kind: "builtin", position: 0 },
    { id: "child", label: "Child", scope: "session", groupId: "group", kind: "file", position: 1 },
  ];
  const groups = [{ id: "group", name: "Docs", scope: "session", position: 0 }];
  const view = buildPinnedWidgetViewModel(widgets, groups, [{ scope: "session", title: "Session" }]);

  assert.deepEqual(view.sections[0].builtinWidgets.map(({ id }) => id), ["builtin"]);
  assert.deepEqual(view.sections[0].movableWidgets.map(({ id }) => id), ["later"]);
  assert.deepEqual(view.sections[0].groups[0].children.map(({ id }) => id), ["child"]);
  assert.deepEqual(view.groupWidgets.get("group").map(({ id }) => id), ["child"]);
  assert.deepEqual(widgets.map(({ id }) => id), ["later", "builtin", "child"], "input order is not mutated");
});

test("session family grouping and loop sorting are prepared before template rendering", () => {
  const root = { sessionKey: "root", name: "Loop run" };
  const second = { sessionKey: "second", parentSessionKey: "root", name: "Loop iteration 2: work" };
  const first = { sessionKey: "first", parentSessionKey: "root", name: "Loop iteration 1: work" };
  assert.deepEqual(prepareSessionFamilies([root, second, first])[0], {
    session: root, forks: [first, second], loop: true,
  });

  const rootEntry = { session: root, runner: null };
  const secondEntry = { session: second, runner: null };
  const firstEntry = { session: first, runner: null };
  assert.deepEqual(prepareSessionEntryFamilies([rootEntry, secondEntry, firstEntry])[0], {
    entry: rootEntry, children: [firstEntry, secondEntry], loop: true,
  });
});

test("component markup does not sort, filter, map, reduce, serialize, or group collections", () => {
  for (const path of componentFiles(componentsRoot.pathname)) {
    const source = readFileSync(path, "utf8");
    const markup = source.slice(source.indexOf("</script>") + 9);
    assert.doesNotMatch(markup, /\.(?:sort|filter|map|reduce)\s*\(|JSON\.(?:parse|stringify)\s*\(|\{#each\s+group[A-Z]\w*\s*\(/, path);
  }
});
