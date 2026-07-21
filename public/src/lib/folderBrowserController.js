export function createFolderBrowserController({ browse, update, updateTitle, getShowHidden, setPath, toast }) {
  async function load(path) {
    update({ loading: true });
    try {
      const data = await browse(path);
      setPath(data.path);
      updateTitle("New session in folder");
      update({ path: data.path, home: data.home, parent: data.parent, dirs: data.dirs ?? [], showHidden: getShowHidden(), loading: false });
    } catch (error) { update({ loading: false }); toast(error.message || "cannot open folder", "error"); }
  }
  return { load };
}
