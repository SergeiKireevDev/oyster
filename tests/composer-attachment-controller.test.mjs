import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_PERMANENT,
  ATTACHMENT_TEMPORARY,
  createComposerAttachmentController,
  messageWithAttachments,
} from "../public/src/lib/composerAttachmentController.js";

const file = (name, size = 4) => ({ name, size, slice: (start, end) => `${name}:${start}-${end}` });

function harness(overrides = {}) {
  const calls = [];
  const published = [];
  const controller = createComposerAttachmentController({
    publish: (items) => published.push(items),
    chooseDestination: async () => ATTACHMENT_TEMPORARY,
    createTempDir: async () => "/tmp/oyster-attachments/batch",
    chooseFolder: async () => "/work/assets",
    listFileNames: async () => [],
    confirmReplace: async () => true,
    uploadChunk: async (options) => {
      calls.push(["chunk", options.dir, options.name]);
      return { res: { ok: true }, data: { saved: `${options.dir}/${options.name}` } };
    },
    sleep: async () => {},
    toast: (...args) => calls.push(["toast", ...args]),
    ...overrides,
  });
  return { controller, calls, published, latest: () => published.at(-1) };
}

test("attachment paths are appended to the composed message only", () => {
  assert.equal(messageWithAttachments(" hello ", []), "hello");
  assert.equal(messageWithAttachments("look", ["/tmp/a.png"]), "look\n\nAttached file:\n- /tmp/a.png");
  assert.equal(messageWithAttachments("", ["/a", "/b"]), "Attached files:\n- /a\n- /b");
});

test("temporary attachments upload into a fresh /tmp folder and wait in the draft", async () => {
  const { controller, calls, latest, published } = harness();
  await controller.addFiles([file("a.png"), file("b.txt")]);
  assert.deepEqual(calls, [
    ["chunk", "/tmp/oyster-attachments/batch", "a.png"],
    ["chunk", "/tmp/oyster-attachments/batch", "b.txt"],
  ]);
  assert.deepEqual(published[0].map((item) => [item.name, item.uploading, item.progress]), [["a.png", true, 0], ["b.txt", true, 0]]);
  assert.deepEqual(latest().map(({ name, path, temporary, uploading, progress }) => ({ name, path, temporary, uploading, progress })), [
    { name: "a.png", path: "/tmp/oyster-attachments/batch/a.png", temporary: true, uploading: false, progress: 100 },
    { name: "b.txt", path: "/tmp/oyster-attachments/batch/b.txt", temporary: true, uploading: false, progress: 100 },
  ]);
  assert.equal(controller.isUploading(), false);
  assert.deepEqual(controller.paths(), ["/tmp/oyster-attachments/batch/a.png", "/tmp/oyster-attachments/batch/b.txt"]);
});

test("permanent attachments go to the chosen folder and ask before replacing files", async () => {
  const confirmations = [];
  const accepted = harness({
    chooseDestination: async () => ATTACHMENT_PERMANENT,
    listFileNames: async () => ["a.png", "other.txt"],
    confirmReplace: async (dir, names) => { confirmations.push([dir, names]); return true; },
  });
  await accepted.controller.addFiles([file("a.png"), file("b.txt")]);
  assert.deepEqual(confirmations, [["/work/assets", ["a.png"]]]);
  assert.deepEqual(accepted.controller.paths(), ["/work/assets/a.png", "/work/assets/b.txt"]);
  assert.equal(accepted.latest()[0].temporary, false);

  const declined = harness({
    chooseDestination: async () => ATTACHMENT_PERMANENT,
    listFileNames: async () => ["a.png"],
    confirmReplace: async () => false,
  });
  await declined.controller.addFiles([file("a.png")]);
  assert.deepEqual(declined.calls, []);
  assert.deepEqual(declined.controller.paths(), []);
});

test("cancelling the destination or the folder browser attaches nothing", async () => {
  const noDestination = harness({ chooseDestination: async () => null });
  await noDestination.controller.addFiles([file("a.png")]);
  const noFolder = harness({ chooseDestination: async () => ATTACHMENT_PERMANENT, chooseFolder: async () => null });
  await noFolder.controller.addFiles([file("a.png")]);
  assert.deepEqual([noDestination.published, noFolder.published, noDestination.calls, noFolder.calls], [[], [], [], []]);
});

test("a failed upload is reported and dropped while the others stay attached", async () => {
  const { controller, calls } = harness({
    uploadChunk: async (options) => options.name === "bad.bin"
      ? { res: { ok: false, status: 400 }, data: { error: "invalid file name" } }
      : { res: { ok: true }, data: { saved: `${options.dir}/${options.name}` } },
  });
  await controller.addFiles([file("bad.bin"), file("ok.txt")]);
  assert.deepEqual(calls, [["toast", "bad.bin: invalid file name", "error"]]);
  assert.deepEqual(controller.paths(), ["/tmp/oyster-attachments/batch/ok.txt"]);

  const failing = harness({ createTempDir: async () => { throw new Error("disk full"); } });
  await failing.controller.addFiles([file("a.png")]);
  assert.deepEqual(failing.calls, [["toast", "attach failed: disk full", "error"]]);
});

test("removing an attachment mid-upload cancels it and keeps it out of the message", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { controller, latest } = harness({
    uploadChunk: async (options) => {
      if (options.offset === 0) await gate;
      return { res: { ok: true }, data: options.last ? { saved: `${options.dir}/${options.name}` } : { received: options.offset + 1 } };
    },
  });
  const big = { name: "big.bin", size: 16 * 1024 * 1024, slice: () => "chunk" };
  const pending = controller.addFiles([big]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.isUploading(), true);
  controller.remove(latest()[0].id);
  release();
  await pending;
  assert.deepEqual(latest(), []);
  assert.deepEqual(controller.paths(), []);
});

test("attachments follow their draft across session switches", async () => {
  const { controller, latest } = harness();
  await controller.addFiles([file("a.png")]);
  const stashed = controller.swap(null);
  assert.deepEqual(latest(), []);
  assert.deepEqual(controller.paths(), []);
  controller.swap(stashed);
  assert.deepEqual(controller.paths(), ["/tmp/oyster-attachments/batch/a.png"]);
  controller.clear();
  assert.deepEqual(latest(), []);
});

test("the paperclip opens a multi-file chooser that feeds the same flow", async () => {
  let onChange;
  const input = { files: [file("a.png")], click() { this.clicked = true; } };
  const { controller } = harness({
    createUploadInput: () => input,
    registerUploadInput: (_target, handler) => { onChange = handler; },
  });
  controller.chooseFiles();
  assert.deepEqual([input.type, input.multiple, input.clicked], ["file", true, true]);
  await onChange();
  assert.deepEqual(controller.paths(), ["/tmp/oyster-attachments/batch/a.png"]);
});
