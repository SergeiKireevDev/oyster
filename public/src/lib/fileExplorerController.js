import { createUploadChunking, uploadFileInChunks } from "./chunkedUpload.js";

export function registerFileUploadInput(target, onChange) {
  target.addEventListener("change", onChange);
  return () => target.removeEventListener("change", onChange);
}

export function createFileExplorerController({ browse, readFile, saveFile, createFolder: mkdir, uploadChunk, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), createUploadInput, registerUploadInput = registerFileUploadInput, update, updateTitle, openModal, getShowHidden, getWorkdir, getToken, setPath, setEditFile, resetState, toast }) {
  async function load(path) {
    update({ loading: true, mode: "list", error: "" });
    let data;
    try {
      data = await browse(path);
    } catch (error) {
      const message = error.message || "Cannot load files";
      toast(message, "error");
      if (path !== getWorkdir()) return load(getWorkdir());
      update({ loading: false, error: message });
      return;
    }
    setPath(data.path);
    updateTitle("File explorer");
    update({
      mode: "list",
      path: data.path,
      home: data.home,
      workdir: data.workdir,
      parent: data.parent,
      dirs: data.dirs ?? [],
      files: data.files ?? [],
      showHidden: getShowHidden(),
      loading: false,
      token: getToken(),
      uploadText: "⬆ Upload…",
      uploading: false,
    });
  }

  async function show(path) {
    resetState(path);
    update({ mode: "list", path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true, token: getToken(), editPath: "", editContent: "", saving: false, uploading: false, uploadText: "⬆ Upload…", error: "", saveError: "", uploadError: "" });
    openModal({ title: "File explorer", content: "fileExplorer" });
    await load(path);
  }

  async function openEditor(path) {
    let data;
    try {
      data = await readFile(path);
    } catch (error) {
      toast(error.message, "error");
      return;
    }
    setEditFile(path, data.content);
    updateTitle(`✎ ${path.split("/").pop()}`);
    update({ mode: "edit", loading: false, token: getToken(), editPath: path, editContent: data.content, saving: false });
  }

  function chooseFiles(dir) {
    const input = createUploadInput();
    input.type = "file";
    input.multiple = true;
    registerUploadInput(input, () => {
      const files = [...input.files];
      if (files.length) return uploadFiles(dir, files);
    });
    input.click();
  }

  async function uploadFiles(dir, files) {
    update({ uploadError: "" });
    const chunking = createUploadChunking();
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let uploadedBytes = 0;
    const setProgress = () => update({ uploading: true, uploadText: `${Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))}%` });
    setProgress();
    let done = 0;
    for (const file of files) {
      try {
        const completedBytes = files.slice(0, done).reduce((sum, item) => sum + item.size, 0);
        await uploadFileInChunks({
          uploadChunk, sleep, dir, file, chunking,
          onProgress(fileBytes) {
            uploadedBytes = completedBytes + fileBytes;
            setProgress();
          },
        });
        done++;
      } catch (error) {
        const message = `${file.name}: ${error.message}`;
        toast(message, "error");
        update({ uploadError: message });
      }
    }
    if (done) toast(`uploaded ${done} file${done > 1 ? "s" : ""} to ${dir}`);
    update({ uploading: false, uploadText: "⬆ Upload…" });
    await load(dir);
  }

  /** Create a folder in the listed directory; resolves to an error message, or "" on success. */
  async function createFolder(path, name) {
    const folderName = String(name ?? "").trim();
    if (!folderName) return "Enter a folder name";
    try {
      await mkdir({ path, name: folderName });
    } catch (error) {
      const message = error.message || "mkdir failed";
      toast(message, "error");
      return message;
    }
    toast(`created ${folderName}`);
    await load(path);
    return "";
  }

  async function saveEditor(path, content) {
    update({ saving: true, saveError: "" });
    try {
      const data = await saveFile({ path, content });
      toast(`saved ${path.split("/").pop()} (${data.bytes} bytes)`);
    } catch (error) {
      toast(error.message, "error");
      update({ saveError: error.message || "Save failed" });
    } finally {
      update({ saving: false });
    }
  }

  return { load, show, openEditor, chooseFiles, uploadFiles, createFolder, saveEditor };
}
