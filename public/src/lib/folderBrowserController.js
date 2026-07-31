export function createFolderBrowserController({ browse, mkdir, update, updateTitle, getShowHidden, setPath, openAndSwitchSession, setWorkdir, toast }) {
  async function load(path) {
    update({ loading: true, error: "" });
    try {
      const data = await browse(path);
      setPath(data.path);
      updateTitle("New session in folder");
      update({ path: data.path, home: data.home, parent: data.parent, dirs: data.dirs ?? [], showHidden: getShowHidden(), loading: false });
    } catch (error) {
      const message = error.message || "Cannot open folder";
      update({ loading: false, error: message });
      toast(message, "error");
    }
  }
  async function createFolder(path, name) {
    const folderName = name.trim();
    if (!folderName) return;
    update({ creating: true, createError: "" });
    try {
      const data = await mkdir(path, folderName);
      toast(`created ${data.path}`);
      update({ creating: false, createOpen: false, newName: "" });
      await load(data.path);
    } catch (error) {
      const message = `mkdir failed: ${error.message}`;
      toast(message, "error");
      update({ creating: false, createError: message });
    }
  }

  async function createSessionInFolder(path) {
    try {
      await openAndSwitchSession({ dir: path }, { onOpened: () => setWorkdir(path) });
      toast(`folder: ${path}`);
      return true;
    } catch (error) {
      toast(error.message, "error");
      return false;
    }
  }

  return { load, createFolder, createSessionInFolder };
}
