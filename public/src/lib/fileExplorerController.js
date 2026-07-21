export function createFileExplorerController({ browse, update, updateTitle, getShowHidden, getWorkdir, getToken, setPath, toast }) {
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

  return { load };
}
