import { createUploadChunking, uploadFileInChunks } from "./chunkedUpload.js";
import { registerFileUploadInput } from "./fileExplorerController.js";

export const ATTACHMENT_TEMPORARY = "temporary";
export const ATTACHMENT_PERMANENT = "permanent";

/** Append uploaded attachment paths to the message the agent receives. */
export function messageWithAttachments(text, paths = []) {
  const message = String(text ?? "").trim();
  if (!paths.length) return message;
  const list = `Attached file${paths.length > 1 ? "s" : ""}:\n${paths.map((path) => `- ${path}`).join("\n")}`;
  return message ? `${message}\n\n${list}` : list;
}

function attachmentView({ id, name, path, temporary, uploading, progress }) {
  return { id, name, path, temporary, uploading, progress };
}

/**
 * Owns the composer's pending attachments. Files are uploaded as soon as their
 * destination is chosen, but they only reach the agent when the message is sent.
 */
export function createComposerAttachmentController({
  publish, chooseDestination, createTempDir, chooseFolder, listFileNames, confirmReplace, uploadChunk,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createUploadInput, registerUploadInput = registerFileUploadInput, toast,
}) {
  let items = [];
  let nextId = 0;
  // Uploads may finish after their draft was switched away; only the visible draft is published.
  const emit = (list) => { if (list === items) publish(items.map(attachmentView)); };

  async function destinationFor(files) {
    const destination = await chooseDestination(files);
    if (destination === ATTACHMENT_TEMPORARY) return { dir: await createTempDir(), temporary: true };
    if (destination !== ATTACHMENT_PERMANENT) return null;
    const dir = await chooseFolder(files);
    if (!dir) return null;
    const existing = new Set(await listFileNames(dir));
    const conflicts = files.map((file) => file.name).filter((name) => existing.has(name));
    if (conflicts.length && !await confirmReplace(dir, conflicts)) return null;
    return { dir, temporary: false };
  }

  async function addFiles(fileList) {
    const files = [...(fileList ?? [])].filter((file) => file?.name);
    if (!files.length) return;
    const target = items;
    let destination;
    try {
      destination = await destinationFor(files);
    } catch (error) {
      toast(`attach failed: ${error.message}`, "error");
      return;
    }
    if (!destination) return;
    const added = files.map((file) => ({
      id: `attachment-${++nextId}`, file, name: file.name, path: "", temporary: destination.temporary,
      uploading: true, progress: 0, removed: false,
    }));
    target.push(...added);
    emit(target);
    const chunking = createUploadChunking();
    for (const item of added) {
      if (item.removed) continue;
      try {
        const result = await uploadFileInChunks({
          uploadChunk, sleep, dir: destination.dir, file: item.file, chunking,
          isCancelled: () => item.removed,
          onProgress(bytes) {
            item.progress = item.file.size ? Math.min(100, Math.round((bytes / item.file.size) * 100)) : 100;
            emit(target);
          },
        });
        if (result.cancelled) continue;
        Object.assign(item, { path: result.path, uploading: false, progress: 100, file: null });
      } catch (error) {
        toast(`${item.name}: ${error.message}`, "error");
        item.removed = true;
        const index = target.indexOf(item);
        if (index !== -1) target.splice(index, 1);
      }
      emit(target);
    }
  }

  function chooseFiles() {
    const input = createUploadInput();
    input.type = "file";
    input.multiple = true;
    registerUploadInput(input, () => addFiles(input.files));
    input.click();
  }

  function remove(id) {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    // The uploaded file stays where the user put it; it just leaves this message.
    items[index].removed = true;
    items.splice(index, 1);
    emit(items);
  }

  return {
    addFiles,
    chooseFiles,
    remove,
    isUploading: () => items.some((item) => item.uploading),
    paths: () => items.filter((item) => !item.uploading).map((item) => item.path),
    clear() {
      items = [];
      emit(items);
    },
    /** Swap in another draft's attachments and return the ones being put away. */
    swap(next) {
      const previous = items;
      items = next ?? [];
      emit(items);
      return previous;
    },
  };
}
