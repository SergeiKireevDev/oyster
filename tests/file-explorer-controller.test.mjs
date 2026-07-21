import test from "node:test";
import assert from "node:assert/strict";
import { createFileExplorerController } from "../public/src/lib/fileExplorerController.js";

test("file explorer loads a directory into its list state", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    browse: async (path) => ({ path, home: "/home", workdir: "/work", parent: "/", dirs: [{ name: "src" }], files: [{ name: "a.txt" }] }),
    update: (value) => calls.push(["update", value]),
    updateTitle: (value) => calls.push(["title", value]),
    getShowHidden: () => false,
    getToken: () => "token",
    setPath: (value) => calls.push(["path", value]),
    toast: () => calls.push(["toast"]),
  });

  await controller.load("/work/src");

  assert.deepEqual(calls, [
    ["update", { loading: true, mode: "list" }],
    ["path", "/work/src"],
    ["title", "📁 File explorer"],
    ["update", { mode: "list", path: "/work/src", home: "/home", workdir: "/work", parent: "/", dirs: [{ name: "src" }], files: [{ name: "a.txt" }], showHidden: false, loading: false, token: "token", uploadText: "⬆ Upload…", uploading: false }],
  ]);
});

test("file explorer opens a file in editor state", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    readFile: async (path) => ({ content: "hello" }),
    getToken: () => "token",
    setEditFile: (path, content) => calls.push(["edit", path, content]),
    updateTitle: (title) => calls.push(["title", title]),
    update: (value) => calls.push(["update", value]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.openEditor("/work/a.txt");

  assert.deepEqual(calls, [
    ["edit", "/work/a.txt", "hello"],
    ["title", "✎ a.txt"],
    ["update", { mode: "edit", loading: false, token: "token", editPath: "/work/a.txt", editContent: "hello", saving: false }],
  ]);
});

test("file explorer reports an editor load error", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    readFile: async () => { throw new Error("cannot open file"); },
    toast: (...args) => calls.push(args),
  });

  await controller.openEditor("/work/a.txt");

  assert.deepEqual(calls, [["cannot open file", "error"]]);
});

test("file explorer retries its workdir after another folder cannot load", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    browse: async (path) => {
      calls.push(["browse", path]);
      if (path === "/gone") throw new Error("cannot open folder");
      return { path, home: "/home", workdir: "/work", parent: null };
    },
    update: (value) => calls.push(["update", value]),
    updateTitle: () => {},
    getShowHidden: () => true,
    getWorkdir: () => "/work",
    getToken: () => "token",
    setPath: () => {},
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.load("/gone");

  assert.deepEqual(calls.slice(0, 5), [
    ["update", { loading: true, mode: "list" }],
    ["browse", "/gone"],
    ["update", { loading: false }],
    ["toast", "cannot open folder", "error"],
    ["update", { loading: true, mode: "list" }],
  ]);
  assert.equal(calls[5][1], "/work");
});
