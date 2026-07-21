import test from "node:test";
import assert from "node:assert/strict";
import { createFilePickerController } from "../public/src/lib/filePickerController.js";

test("file picker loads a directory into picker state", async () => {
  const calls = [];
  const controller = createFilePickerController({
    browse: async (path) => ({ path, home: "/home", workdir: "/work", parent: "/", dirs: [], files: [{ name: "a.txt" }] }),
    update: (value) => calls.push(["update", value]),
    updateTitle: (value) => calls.push(["title", value]),
    getShowHidden: () => false,
    setPath: (value) => calls.push(["path", value]),
    toast: () => {},
  });

  await controller.load("/work");

  assert.deepEqual(calls, [
    ["update", { loading: true }],
    ["path", "/work"],
    ["title", "Attach file"],
    ["update", { path: "/work", home: "/home", workdir: "/work", parent: "/", dirs: [], files: [{ name: "a.txt" }], showHidden: false, loading: false }],
  ]);
});

test("file picker initializes its modal before loading the current workdir", async () => {
  const calls = [];
  const controller = createFilePickerController({
    resetState: (value) => calls.push(["reset", value]),
    update: (value) => calls.push(["update", value]),
    openModal: (value) => calls.push(["modal", value]),
    browse: async (path) => { calls.push(["browse", path]); return { path, dirs: [], files: [] }; },
    updateTitle: () => {},
    getShowHidden: () => true,
    setPath: () => {},
    toast: () => {},
  });
  const onPick = () => {};

  await controller.show({ path: "/work", onPick, onCancel: null, returnToHublot: true });

  assert.deepEqual(calls.slice(0, 4), [
    ["reset", { path: "/work", onPick, onCancel: null, returnToHublot: true }],
    ["update", { path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true }],
    ["modal", { title: "Attach file", content: "filePicker" }],
    ["update", { loading: true }],
  ]);
  assert.equal(calls[4][1], "/work");
});

test("file picker completes a selection and returns to the hublot when requested", async () => {
  const calls = [];
  const controller = createFilePickerController({
    closeModal: () => calls.push("close"),
    showHublots: async () => calls.push("hublots"),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  controller.complete({ path: "/work/a.txt", onPick: (path) => calls.push(["pick", path]), returnToHublot: true });
  await Promise.resolve();

  assert.deepEqual(calls, [["pick", "/work/a.txt"], "close", "hublots"]);
});

test("file picker completes cancellation without selecting a path", () => {
  const calls = [];
  const controller = createFilePickerController({ closeModal: () => calls.push("close"), showHublots: async () => {}, toast: () => {} });

  controller.complete({ onCancel: () => calls.push("cancel"), cancel: true });

  assert.deepEqual(calls, ["cancel", "close"]);
});

test("file picker falls back to its workdir after a failed browse", async () => {
  const calls = [];
  const controller = createFilePickerController({
    browse: async (path) => { calls.push(["browse", path]); if (path === "/gone") throw new Error("cannot open folder"); return { path, dirs: [], files: [] }; },
    update: (value) => calls.push(["update", value]),
    updateTitle: () => {},
    getShowHidden: () => true,
    getWorkdir: () => "/work",
    setPath: () => {},
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.load("/gone");

  assert.deepEqual(calls.slice(0, 5), [
    ["update", { loading: true }], ["browse", "/gone"], ["update", { loading: false }],
    ["toast", "cannot open folder", "error"], ["update", { loading: true }],
  ]);
  assert.equal(calls[5][1], "/work");
});
