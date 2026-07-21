export function createFileExplorerController({ browse, readFile, update, updateTitle, getShowHidden, getWorkdir, getToken, setPath, setEditFile, toast }) {
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

  return { load, openEditor };
}
