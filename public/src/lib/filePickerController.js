export function createFilePickerController({ browse, update, updateTitle, getShowHidden, getWorkdir, setPath, toast }) {
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

  return { load };
}
