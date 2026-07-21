import test from "node:test";
import assert from "node:assert/strict";
import { createFolderBrowserController } from "../public/src/lib/folderBrowserController.js";

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
