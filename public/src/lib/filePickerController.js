export function createFilePickerController({ browse, update, updateTitle, openModal, closeModal, showHublots, getShowHidden, getWorkdir, setPath, resetState, toast }) {
  async function load(path) {
    update({ loading: true, error: "" });
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
    updateTitle("Attach file");
    update({ path: data.path, home: data.home, workdir: data.workdir, parent: data.parent, dirs: data.dirs ?? [], files: data.files ?? [], showHidden: getShowHidden(), loading: false });
  }

  async function show({ path, onPick, onCancel, returnToHublot }) {
    resetState({ path, onPick, onCancel, returnToHublot });
    update({ path: "", home: "", workdir: "", parent: null, dirs: [], files: [], showHidden: true, loading: true, error: "" });
    openModal({ title: "Attach file", content: "filePicker" });
    await load(path);
  }

  function complete({ path, onPick, onCancel, cancel = false, returnToHublot = false }) {
    if (cancel) onCancel?.();
    else onPick?.(path);
    closeModal();
    if (returnToHublot) showHublots().catch((error) => toast(error.message, "error"));
  }

  return { load, show, complete };
}
