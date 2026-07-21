export function createFilePickerController({ browse, update, updateTitle, openModal, getShowHidden, getWorkdir, setPath, resetState, toast }) {
  async function load(path) {
    update({ loading: true });
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
    updateTitle("Attach file");
    update({ path: data.path, home: data.home, workdir: data.workdir, parent: data.parent, dirs: data.dirs ?? [], files: data.files ?? [], showHidden: getShowHidden(), loading: false });
  }

  async function show({ path, onPick, onCancel, returnToHublot }) {
    resetState({ path, onPick, onCancel, returnToHublot });
    update({ path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true });
    openModal({ title: "Attach file", content: "filePicker" });
    await load(path);
  }

  return { load, show };
}
