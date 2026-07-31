export function registerFileUploadInput(target, onChange) {
  target.addEventListener("change", onChange);
  return () => target.removeEventListener("change", onChange);
}

export function createFileExplorerController({ browse, readFile, saveFile, uploadChunk, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), createUploadInput, registerUploadInput = registerFileUploadInput, update, updateTitle, openModal, getShowHidden, getWorkdir, getToken, setPath, setEditFile, resetState, toast }) {
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
    // Stay below common reverse-proxy body limits. If an intermediary has a
    // smaller limit, a 413 transparently halves subsequent chunks and retries
    // the same offset instead of failing the whole file.
    let chunkSize = 8 * 1024 * 1024;
    const minChunkSize = 64 * 1024;
    const maxRetries = 6;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let uploadedBytes = 0;
    const setProgress = () => update({ uploading: true, uploadText: `${Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))}%` });
    setProgress();
    let done = 0;
    const uploadErrors = [];
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
          if (res.status === 413 && chunkSize > minChunkSize) {
            chunkSize = Math.max(minChunkSize, Math.floor(Math.min(chunkSize, end - offset) / 2));
            attempts = 0;
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
      } catch (error) {
        const message = `${file.name}: ${error.message}`;
        uploadErrors.push(message);
        update({ uploadError: message });
      }
    }
    if (uploadErrors.length) {
      const summary = uploadErrors.length === 1
        ? uploadErrors[0]
        : `${uploadErrors.length} files failed to upload`;
      toast(done ? `uploaded ${done} file${done > 1 ? "s" : ""}; ${summary}` : summary, "error");
    } else if (done) {
      toast(`uploaded ${done} file${done > 1 ? "s" : ""} to ${dir}`);
    }
    update({ uploading: false, uploadText: "⬆ Upload…" });
    await load(dir);
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

  return { load, show, openEditor, chooseFiles, uploadFiles, saveEditor };
}
