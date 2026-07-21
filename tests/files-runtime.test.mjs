import test from "node:test";
import assert from "node:assert/strict";
import { createFilesRuntime } from "../public/src/features/files/createFilesRuntime.js";

test("files runtime assembles picker folder browser and explorer controllers with owned state", () => {
  const runtime = createFilesRuntime({
    pickerState: () => ({ curDir: "", showHidden: true, onPick: () => {}, onCancel: null, returnToHublot: false }),
    folderState: () => ({ browsePath: "", showHidden: true, done: null }),
    explorerState: () => ({ curPath: "", showHidden: true, editPath: "", editContent: "" }),
    picker: ({ state }) => ({
      browse: async () => ({ path: "/tmp", entries: [] }),
      update() {}, updateTitle() {}, openModal() {}, closeModal() {}, showHublots() {},
      getShowHidden: () => state.picker.showHidden,
      getWorkdir: () => "/tmp",
      setPath: (path) => { state.picker.curDir = path; },
      resetState: ({ path, onPick, onCancel, returnToHublot }) => Object.assign(state.picker, { curDir: path, onPick, onCancel, returnToHublot }),
      toast() {},
    }),
    folderBrowser: ({ state }) => ({
      browse: async () => ({ path: "/tmp", dirs: [] }),
      mkdir: async () => ({}), update() {}, updateTitle() {}, getShowHidden: () => state.folder.showHidden,
      setPath: (path) => { state.folder.browsePath = path; }, openAndSwitchSession() {}, setWorkdir() {}, toast() {},
    }),
    explorer: ({ state }) => ({
      browse: async () => ({ path: "/tmp", entries: [] }), readFile: async () => "", saveFile: async () => ({}), uploadChunk: async () => ({}),
      createUploadInput: () => ({ addEventListener() {}, click() {} }), update() {}, updateTitle() {}, openModal() {},
      getShowHidden: () => state.explorer.showHidden, getWorkdir: () => "/tmp", getToken: () => "token",
      setPath: (path) => { state.explorer.curPath = path; }, setEditFile: (path, content) => Object.assign(state.explorer, { editPath: path, editContent: content }), resetState() {}, toast() {},
    }),
  });

  assert.equal(typeof runtime.picker.show, "function");
  assert.equal(typeof runtime.folderBrowser.load, "function");
  assert.equal(typeof runtime.explorer.chooseFiles, "function");
  assert.deepEqual(Object.keys(runtime.state), ["picker", "folder", "explorer"]);
});
