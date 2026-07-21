export function createFilePickerEventController({ windowTarget, useFolder, browse, pick, cancel }) {
  const listeners = [
    ["pi-file-picker-use-folder", () => useFolder()],
    ["pi-file-picker-browse", (event) => browse(event.detail)],
    ["pi-file-picker-pick", (event) => pick(event.detail)],
    ["pi-file-picker-cancel", () => cancel()],
  ];
  function attach() { for (const [name, listener] of listeners) windowTarget.addEventListener(name, listener); return detach; }
  function detach() { for (const [name, listener] of listeners) windowTarget.removeEventListener(name, listener); }
  return { attach, detach };
}

export function createFilePickerController({ browse, update, updateTitle, openModal, closeModal, showHublots, getShowHidden, getWorkdir, setPath, resetState, toast }) {
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

  function complete({ path, onPick, onCancel, cancel = false, returnToHublot = false }) {
    if (cancel) onCancel?.();
    else onPick?.(path);
    closeModal();
    if (returnToHublot) showHublots().catch((error) => toast(error.message, "error"));
  }

  return { load, show, complete };
}
