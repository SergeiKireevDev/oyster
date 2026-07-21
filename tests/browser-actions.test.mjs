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

test("browser actions build encoded file downloads with stable filenames", () => {
  const actions = createBrowserActions({ windowTarget: { open() {} } });

  assert.deepEqual(actions.fileDownload("token +/?", "/workspace/a file #1.txt"), {
    href: "/file-download?token=token%20%2B%2F%3F&path=%2Fworkspace%2Fa%20file%20%231.txt",
    filename: "a file #1.txt",
  });
  assert.deepEqual(actions.fileDownload("token", "/"), {
    href: "/file-download?token=token&path=%2F",
    filename: "download",
  });
});

test("hublot components invoke injected browser actions without direct window access", () => {
  for (const name of ["HublotList.svelte", "HublotManagerModal.svelte"]) {
    const source = readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
    assert.match(source, /getBrowserActions\(\)/);
    assert.match(source, /browserActions\.openExternal\(/);
    assert.doesNotMatch(source, /window\.open/);
  }

  const list = readFileSync(new URL("../public/src/components/HublotList.svelte", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../public/src/components/HublotSidebar.svelte", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(list, /<button type="button" class="hublot-block" onclick=\{openFileExplorer\}>/);
  assert.match(list, /<button type="button" class="hit"[^>]*onclick=\{\(\) => browserActions\.openExternal\(hublot\.url\)\}/);
  assert.match(manager, /<button[\s\S]*type="button"[\s\S]*class="hit"[\s\S]*browserActions\.openExternal\(tunnel\.url\)/);
  assert.match(sidebar, /<button type="button" id="hublotAdd"[^>]*onclick=\{showHublotManager\}>/);
  for (const source of [list, manager, sidebar]) assert.doesNotMatch(source, /role="button"/);
  assert.match(styles, /\.hublot-block \.preview \.hit \{[\s\S]*position: absolute; inset: 0;/);

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
