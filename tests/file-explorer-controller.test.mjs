import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFileExplorerController } from "../public/src/lib/fileExplorerController.js";

const fileExplorerComponent = readFileSync(new URL("../public/src/components/FileExplorerModal.svelte", import.meta.url), "utf8");

test("file explorer renders upload progress without injecting controller markup", () => {
  assert.doesNotMatch(fileExplorerComponent, /\{@html/);
  assert.match(fileExplorerComponent, /<span class="spin" aria-hidden="true">⟳<\/span>/);
});

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
    ["update", { loading: true, mode: "list", error: "" }],
    ["path", "/work/src"],
    ["title", "File explorer"],
    ["update", { mode: "list", path: "/work/src", home: "/home", workdir: "/work", parent: "/", dirs: [{ name: "src" }], files: [{ name: "a.txt" }], showHidden: false, loading: false, token: "token", uploadText: "⬆ Upload…", uploading: false }],
  ]);
});

test("file explorer initializes its modal before loading the workdir", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    resetState: (path) => calls.push(["reset", path]),
    update: (value) => calls.push(["update", value]),
    openModal: (value) => calls.push(["modal", value]),
    browse: async (path) => { calls.push(["browse", path]); return { path, home: "/home", workdir: "/work", parent: null }; },
    updateTitle: () => {},
    getShowHidden: () => true,
    getToken: () => "token",
    setPath: () => {},
    toast: () => {},
  });

  await controller.show("/work");

  assert.deepEqual(calls.slice(0, 4), [
    ["reset", "/work"],
    ["update", { mode: "list", path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true, token: "token", editPath: "", editContent: "", saving: false, uploading: false, uploadText: "⬆ Upload…", error: "", saveError: "", uploadError: "" }],
    ["modal", { title: "File explorer", content: "fileExplorer" }],
    ["update", { loading: true, mode: "list", error: "" }],
  ]);
  assert.equal(calls[4][1], "/work");
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

test("file explorer owns the upload-input workflow", () => {
  const input = { click: () => { input.clicked = true; }, files: [{ name: "a.txt" }] };
  let listener;
  const controller = createFileExplorerController({
    createUploadInput: () => input,
    registerUploadInput: (_input, callback) => { listener = callback; },
    uploadChunk: async () => ({ res: { ok: true }, data: {} }),
    browse: async (path) => ({ path, dirs: [], files: [] }), update: () => {}, updateTitle: () => {},
    getShowHidden: () => true, getToken: () => "token", setPath: () => {}, toast: () => {},
  });
  controller.chooseFiles("/work");
  assert.equal(input.type, "file");
  assert.equal(input.multiple, true);
  assert.equal(input.clicked, true);
  assert.equal(typeof listener, "function");
});

test("file explorer uploads files, reports progress, and reloads the directory", async () => {
  const calls = [];
  const file = { name: "a.txt", size: 3, slice: (start, end) => `${start}-${end}` };
  const controller = createFileExplorerController({
    uploadChunk: async (options) => { calls.push(["chunk", options]); return { res: { ok: true }, data: { saved: true } }; },
    browse: async (path) => { calls.push(["browse", path]); return { path, dirs: [], files: [] }; },
    update: (value) => calls.push(["update", value]),
    updateTitle: () => {},
    getShowHidden: () => true,
    getToken: () => "token",
    setPath: () => {},
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.uploadFiles("/work", [file]);

  assert.deepEqual(calls.slice(0, 6), [
    ["update", { uploadError: "" }],
    ["update", { uploading: true, uploadText: "0%" }],
    ["chunk", { dir: "/work", name: "a.txt", offset: 0, last: true, body: "0-3" }],
    ["update", { uploading: true, uploadText: "100%" }],
    ["toast", "uploaded 1 file to /work"],
    ["update", { uploading: false, uploadText: "⬆ Upload…" }],
  ]);
  assert.equal(calls[7][1], "/work");
});

test("file explorer splits large uploads below common proxy body limits", async () => {
  const chunks = [];
  const size = 9 * 1024 * 1024 + 17;
  const controller = createFileExplorerController({
    uploadChunk: async (options) => {
      chunks.push(options);
      const end = Number(options.body.split("-")[1]);
      return { res: { ok: true }, data: options.last ? { saved: true } : { received: end } };
    },
    browse: async (path) => ({ path, dirs: [], files: [] }),
    update: () => {}, updateTitle: () => {}, getShowHidden: () => true, getToken: () => "token",
    setPath: () => {}, toast: () => {},
  });

  await controller.uploadFiles("/work", [{ name: "large.json", size, slice: (start, end) => `${start}-${end}` }]);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].body, "0-8388608");
  assert.equal(chunks.at(-1).body, `8388608-${size}`);
  assert.equal(chunks.at(-1).last, true);
  for (const [index, chunk] of chunks.entries()) {
    const [start, end] = chunk.body.split("-").map(Number);
    assert.equal(chunk.offset, start);
    assert.ok(end - start <= 8 * 1024 * 1024);
    if (index) assert.equal(start, Number(chunks[index - 1].body.split("-")[1]));
  }
});

test("file explorer backs off its chunk size after intermediary 413 responses", async () => {
  const attempts = [];
  const accepted = [];
  const size = 700 * 1024;
  const controller = createFileExplorerController({
    uploadChunk: async (options) => {
      attempts.push(options.body);
      const [start, end] = options.body.split("-").map(Number);
      if (end - start > 64 * 1024) return { res: { ok: false, status: 413 }, data: {} };
      accepted.push(options.body);
      return { res: { ok: true }, data: options.last ? { saved: true } : { received: end } };
    },
    browse: async (path) => ({ path, dirs: [], files: [] }),
    update: () => {}, updateTitle: () => {}, getShowHidden: () => true, getToken: () => "token",
    setPath: () => {}, toast: () => {},
  });

  await controller.uploadFiles("/work", [{ name: "limited.bin", size, slice: (start, end) => `${start}-${end}` }]);

  assert.deepEqual(attempts.slice(0, 5), ["0-716800", "0-358400", "0-179200", "0-89600", "0-65536"]);
  assert.equal(accepted[0], "0-65536");
  assert.equal(accepted.at(-1), `655360-${size}`);
});

test("file explorer reports an unrecoverable upload error and resets progress", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    uploadChunk: async () => ({ res: { ok: false, status: 400 }, data: { error: "invalid file" } }),
    browse: async (path) => ({ path, dirs: [], files: [] }),
    update: (value) => calls.push(value),
    updateTitle: () => {}, getShowHidden: () => true, getToken: () => "token", setPath: () => {},
    toast: (...args) => calls.push(args),
  });

  await controller.uploadFiles("/work", [{ name: "a.txt", size: 1, slice: () => "body" }]);

  assert.deepEqual(calls.slice(0, 5), [
    { uploadError: "" },
    { uploading: true, uploadText: "0%" },
    ["a.txt: invalid file", "error"],
    { uploadError: "a.txt: invalid file" },
    { uploading: false, uploadText: "⬆ Upload…" },
  ]);
});

test("file explorer saves editor content and clears its saving state", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    saveFile: async (options) => { calls.push(["save", options]); return { bytes: 5 }; },
    update: (value) => calls.push(["update", value]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await controller.saveEditor("/work/a.txt", "hello");

  assert.deepEqual(calls, [
    ["update", { saving: true, saveError: "" }],
    ["save", { path: "/work/a.txt", content: "hello" }],
    ["toast", "saved a.txt (5 bytes)"],
    ["update", { saving: false }],
  ]);
});

test("file explorer clears saving state after a save error", async () => {
  const calls = [];
  const controller = createFileExplorerController({
    saveFile: async () => { throw new Error("save failed"); },
    update: (value) => calls.push(value),
    toast: (...args) => calls.push(args),
  });

  await controller.saveEditor("/work/a.txt", "hello");

  assert.deepEqual(calls, [
    { saving: true, saveError: "" },
    ["save failed", "error"],
    { saveError: "save failed" },
    { saving: false },
  ]);
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
    ["update", { loading: true, mode: "list", error: "" }],
    ["browse", "/gone"],
    ["toast", "cannot open folder", "error"],
    ["update", { loading: true, mode: "list", error: "" }],
    ["browse", "/work"],
  ]);
});
