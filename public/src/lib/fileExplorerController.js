export function createFileExplorerController({ browse, readFile, saveFile, update, updateTitle, openModal, getShowHidden, getWorkdir, getToken, setPath, setEditFile, resetState, toast }) {
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
    updateTitle("📁 File explorer");
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
    openModal({ title: "📁 File explorer", content: "fileExplorer" });
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

  return { load, show, openEditor, saveEditor };
}
