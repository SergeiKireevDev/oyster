export function createOpenFileExplorerEventController({ windowTarget, open }) {
  const onOpen = () => open();
  function attach() { windowTarget.addEventListener("pi-open-file-explorer", onOpen); return detach; }
  function detach() { windowTarget.removeEventListener("pi-open-file-explorer", onOpen); }
  return { attach, detach };
}

export function createFileExplorerEventController({ windowTarget, browse, edit, save, upload, backToList, backToHublots }) {
  const listeners = [["pi-file-explorer-browse", (event) => browse(event.detail)], ["pi-file-explorer-edit", (event) => edit(event.detail)], ["pi-file-explorer-save", save], ["pi-file-explorer-upload", upload], ["pi-file-explorer-back-list", backToList], ["pi-file-explorer-back-hublots", backToHublots]];
  function attach() { for (const [name, listener] of listeners) windowTarget.addEventListener(name, listener); return detach; }
  function detach() { for (const [name, listener] of listeners) windowTarget.removeEventListener(name, listener); }
  return { attach, detach };
}

export function registerFileUploadInput(target, onChange) {
  target.addEventListener("change", onChange);
  return () => target.removeEventListener("change", onChange);
}

export function createFileExplorerController({ browse, readFile, saveFile, uploadChunk, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), createUploadInput, registerUploadInput = registerFileUploadInput, update, updateTitle, openModal, getShowHidden, getWorkdir, getToken, setPath, setEditFile, resetState, toast }) {
  async function load(path) {
    update({ loading: true, mode: "list" });
    let data;
    try {
      data = await browse(path);
    } catch (error) {
      update({ loading: false });
      toast(error.message, "error");
      if (path !== getWorkdir()) return load(getWorkdir());
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
    update({ mode: "list", path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true, token: getToken(), editPath: "", editContent: "", saving: false, uploading: false, uploadText: "⬆ Upload…" });
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
    const chunkSize = 8 * 1024 * 1024;
    const maxRetries = 6;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let uploadedBytes = 0;
    const setProgress = () => update({ uploading: true, uploadText: `<span class="spin">⟳</span> ${Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))}%` });
    setProgress();
    let done = 0;
    for (const file of files) {
      try {
        let offset = 0;
        let attempts = 0;
        let finished = false;
        while (!finished) {
          const end = Math.min(offset + chunkSize, file.size);
          const last = end >= file.size;
          let response;
          try { response = await uploadChunk({ dir, name: file.name, offset, last, body: file.slice(offset, end) }); }
          catch {
            if (++attempts > maxRetries) throw new Error(`connection lost (gave up after ${maxRetries} retries)`);
            await sleep(1000 * attempts);
            continue;
          }
          const { res, data } = response;
          if (res.ok) {
            attempts = 0;
            if (last || data.saved) finished = true;
            else offset = typeof data.received === "number" ? data.received : end;
            uploadedBytes = files.slice(0, done).reduce((sum, item) => sum + item.size, 0) + (finished ? file.size : offset);
            setProgress();
            continue;
          }
          if (res.status === 409 && typeof data.have === "number") {
            if (++attempts > maxRetries) throw new Error(data.error || "upload out of sync");
            offset = data.have;
            continue;
          }
          if (res.status >= 500 || res.status === 429) {
            if (++attempts > maxRetries) throw new Error(data.error || `upload failed (${res.status})`);
            await sleep(1000 * attempts);
            continue;
          }
          throw new Error(data.error || `upload failed (${res.status})`);
        }
        done++;
      } catch (error) { toast(`${file.name}: ${error.message}`, "error"); }
    }
    if (done) toast(`uploaded ${done} file${done > 1 ? "s" : ""} to ${dir}`);
    update({ uploading: false, uploadText: "⬆ Upload…" });
    await load(dir);
  }

  async function saveEditor(path, content) {
    update({ saving: true });
    try {
      const data = await saveFile({ path, content });
      toast(`saved ${path.split("/").pop()} (${data.bytes} bytes)`);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      update({ saving: false });
    }
  }

  return { load, show, openEditor, chooseFiles, uploadFiles, saveEditor };
}
