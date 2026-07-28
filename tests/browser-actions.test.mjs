import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBrowserActions } from "../public/src/platform/createBrowserActions.js";

test("browser actions open external URLs in an isolated tab", () => {
  const calls = [];
  const opened = {};
  const actions = createBrowserActions({
    windowTarget: { open: (...args) => { calls.push(args); return opened; } },
  });

  assert.equal(actions.openExternal("https://example.test/path"), opened);
  assert.deepEqual(calls, [["https://example.test/path", "_blank", "noopener"]]);
  assert.equal(Object.isFrozen(actions), true);
});

test("browser actions use cookie authentication for encoded file downloads", () => {
  const actions = createBrowserActions({ windowTarget: { open() {} } });

  assert.deepEqual(actions.fileDownload("token +/?", "/workspace/a file #1.txt"), {
    href: "/file-download?path=%2Fworkspace%2Fa%20file%20%231.txt",
    filename: "a file #1.txt",
  });
  assert.deepEqual(actions.fileDownload("token", "/"), {
    href: "/file-download?path=%2F",
    filename: "download",
  });
  assert.doesNotMatch(actions.fileDownload("token", "/file").href, /token=/);
});

test("pinned widget components use injected browser actions without direct window access", () => {
  const manager = readFileSync(new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../public/src/components/PinnedWidgetViewerModal.svelte", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../public/src/components/HublotSidebar.svelte", import.meta.url), "utf8");
  assert.match(manager, /getBrowserActions\(\)/);
  assert.match(manager, /browserActions\.openExternal\(tunnel\.url\)/);
  assert.match(viewer, /getBrowserActions\(\)/);
  assert.match(viewer, /browserActions\.fileDownload\(/);
  assert.match(grid, /uiActions\.invoke\(PINNED_WIDGET_OPEN_ACTION, widget\)/);
  assert.match(sidebar, /<button type="button" id="hublotAdd"[^>]*onclick=\{showWidgetManager\}>/);
  for (const source of [manager, viewer, grid, sidebar]) assert.doesNotMatch(source, /window\.open|role="button"/);

  const root = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(root, /openUrl: browserActions\.openExternal/);
  assert.doesNotMatch(root, /window\.open/);
});

test("file explorer consumes injected download descriptors", () => {
  const source = readFileSync(new URL("../public/src/components/FileExplorerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getBrowserActions\(\)/);
  assert.match(source, /browserActions\.fileDownload\(/);
  assert.match(source, /href=\{download\.href\}/);
  assert.match(source, /download=\{download\.filename\}/);
  assert.match(source, /href=\{editedFileDownload\.href\}/);
  assert.match(source, /download=\{editedFileDownload\.filename\}/);
  assert.doesNotMatch(source, /file-download|encodeURIComponent|downloadFileUrl|split\("\/"\)\.pop/);
});
