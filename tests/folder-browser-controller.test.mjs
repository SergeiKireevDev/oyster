import test from "node:test";
import assert from "node:assert/strict";
import { createFolderBrowserController } from "../public/src/lib/folderBrowserController.js";

test("folder browser creates a folder and loads it", async () => {
  const calls = [];
  const controller = createFolderBrowserController({
    mkdir: async (path, name) => { calls.push(["mkdir", path, name]); return { path: "/workspace/project/new" }; },
    browse: async (path) => { calls.push(["browse", path]); return { path, home: "/home", parent: "/workspace/project", dirs: [] }; },
    update: (value) => calls.push(["update", value]),
    updateTitle: (title) => calls.push(["title", title]),
    getShowHidden: () => true,
    setPath: (path) => calls.push(["path", path]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.createFolder("/workspace/project", " new ");

  assert.deepEqual(calls, [
    ["update", { creating: true }],
    ["mkdir", "/workspace/project", "new"],
    ["toast", "created /workspace/project/new"],
    ["update", { creating: false, createOpen: false, newName: "" }],
    ["update", { loading: true }],
    ["browse", "/workspace/project/new"],
    ["path", "/workspace/project/new"],
    ["title", "New session in folder"],
    ["update", { path: "/workspace/project/new", home: "/home", parent: "/workspace/project", dirs: [], showHidden: true, loading: false }],
  ]);
});

test("folder browser keeps its creation form open when mkdir fails", async () => {
  const calls = [];
  const controller = createFolderBrowserController({
    mkdir: async () => { throw new Error("permission denied"); },
    update: (value) => calls.push(value),
    toast: (...args) => calls.push(args),
  });

  await controller.createFolder("/workspace/project", "new");

  assert.deepEqual(calls, [{ creating: true }, ["mkdir failed: permission denied", "error"], { creating: false }]);
});

test("folder browser creates and switches to a runner for the chosen folder", async () => {
  const calls = [];
  const controller = createFolderBrowserController({
    openSessionRunner: async (options) => { calls.push(["open", options]); return { id: "runner-1" }; },
    setWorkdir: (path) => calls.push(["workdir", path]),
    switchToRunner: (id) => calls.push(["switch", id]),
    toast: (message, level) => calls.push(["toast", message, level]),
  });

  await controller.createSessionInFolder("/workspace/project");

  assert.deepEqual(calls, [
    ["open", { dir: "/workspace/project" }],
    ["workdir", "/workspace/project"],
    ["switch", "runner-1"],
    ["toast", "folder: /workspace/project", undefined],
  ]);
});

test("folder browser reports a failed chosen-folder session without switching", async () => {
  const calls = [];
  const controller = createFolderBrowserController({
    openSessionRunner: async () => { throw new Error("runner unavailable"); },
    setWorkdir: () => calls.push("workdir"),
    switchToRunner: () => calls.push("switch"),
    toast: (...args) => calls.push(args),
  });

  await controller.createSessionInFolder("/workspace/project");

  assert.deepEqual(calls, [["runner unavailable", "error"]]);
});
