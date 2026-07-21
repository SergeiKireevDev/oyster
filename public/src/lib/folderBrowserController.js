export function createFolderBrowserController({ browse, mkdir, update, updateTitle, getShowHidden, setPath, openSessionRunner, setWorkdir, switchToRunner, toast }) {
  async function load(path) {
    update({ loading: true });
    try {
      const data = await browse(path);
      setPath(data.path);
      updateTitle("New session in folder");
      update({ path: data.path, home: data.home, parent: data.parent, dirs: data.dirs ?? [], showHidden: getShowHidden(), loading: false });
    } catch (error) { update({ loading: false }); toast(error.message || "cannot open folder", "error"); }
  }
  async function createFolder(path, name) {
    const folderName = name.trim();
    if (!folderName) return;
    update({ creating: true });
    try {
      const data = await mkdir(path, folderName);
      toast(`created ${data.path}`);
      update({ creating: false, createOpen: false, newName: "" });
      await load(data.path);
    } catch (error) {
      toast(`mkdir failed: ${error.message}`, "error");
      update({ creating: false });
    }
  }

  async function createSessionInFolder(path) {
    try {
      const runner = await openSessionRunner({ dir: path });
      setWorkdir(path);
      switchToRunner(runner.id);
      toast(`folder: ${path}`);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  return { load, createFolder, createSessionInFolder };
}
