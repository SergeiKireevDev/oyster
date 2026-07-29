import {
  createPinnedWidgetGroup,
  deletePinnedWidgetGroup,
  pinLink,
  pinPath,
  readPinnedTextArtifact,
  unpinWidget,
  updatePinnedWidget,
  updatePinnedWidgetGroup,
} from "../../lib/pinnedWidgetActions.js";

/** Instance-scoped workflows for the Pinned Widgets rail and native viewers. */
export function createPinnedWidgetRuntime(deps) {
  const sessionId = () => deps.getSessionId() ?? null;
  const refresh = async () => deps.load();

  async function pinArtifactPath(path) {
    try {
      const data = await pinPath(deps.fetchImpl, { path, sessionId: sessionId() });
      deps.setCollection(data);
      deps.toast(`pinned ${String(path).split("/").pop() || path}`);
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function open(widget) {
    if (widget.availability !== "ready") {
      deps.toast(`${widget.label} is ${widget.availability}`, widget.availability === "opening" ? "warning" : "error");
      return;
    }
    if (widget.kind === "live_interface" || widget.kind === "link") {
      deps.openExternal(widget.url);
      return;
    }
    if (widget.kind === "builtin" && widget.builtin === "file-explorer") {
      await deps.showFileExplorer();
      return;
    }
    if (widget.kind === "directory") {
      await deps.showFileExplorer(widget.path);
      return;
    }
    if (["image", "video"].includes(widget.kind)) {
      deps.openModal({ title: widget.label, wide: true, content: "pinnedWidgetViewer", context: { widget } });
      return;
    }
    if (String(widget.mimeType ?? "").startsWith("text/html")) {
      deps.openModal({ title: widget.label, wide: true, content: "pinnedWidgetViewer", context: { widget } });
      return;
    }
    if (widget.kind === "markdown") {
      try {
        const data = await readPinnedTextArtifact(deps.fetchImpl, widget.id);
        deps.openModal({ title: widget.label, wide: true, content: "pinnedWidgetViewer", context: { widget: { ...widget, content: data.content } } });
      } catch (error) { deps.toast(error.message, "error"); }
      return;
    }
    if (widget.path) {
      const directory = widget.path.slice(0, widget.path.lastIndexOf("/")) || "/";
      await deps.showFileExplorer(directory);
      await deps.editFile(widget.path);
    }
  }

  async function move({ id, scope, groupId = null, beforeId = null }) {
    try {
      await updatePinnedWidget(deps.fetchImpl, { id, scope, groupId, beforeId, sessionId: sessionId() });
      await refresh();
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function moveGroup({ id, scope }) {
    try {
      await updatePinnedWidgetGroup(deps.fetchImpl, { id, scope, sessionId: sessionId() });
      await refresh();
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function manage(widget) {
    const groups = deps.getGroups().filter((group) => group.scope === widget.scope);
    const destinations = [
      ...(widget.groupId ? [{ label: "Top level", groupId: null }] : []),
      ...groups.filter((group) => group.id !== widget.groupId).map((group) => ({ label: group.name, groupId: group.id })),
    ];
    const actions = [
      { label: "Rename", run: async () => {
        const label = await deps.dialogs.openText("Rename pinned widget", "Widget label", widget.label);
        if (label?.trim()) await updatePinnedWidget(deps.fetchImpl, { id: widget.id, label, sessionId: sessionId() });
      } },
      ...(destinations.length ? [{ label: "Move to", run: async () => {
        const destination = await deps.dialogs.openOption(`Move ${widget.label} to`, destinations.map((item) => item.label));
        if (destination != null) {
          await updatePinnedWidget(deps.fetchImpl, {
            id: widget.id,
            groupId: destinations[destination].groupId,
            sessionId: sessionId(),
          });
        }
      } }] : []),
      ...(widget.kind === "live_interface" ? [{ label: "Close live interface", run: () => deps.closeLiveInterface(widget.hublotId) }] : []),
      { label: "Unpin", run: () => unpinWidget(deps.fetchImpl, widget.id) },
    ];
    const choice = await deps.dialogs.openOption(`Manage ${widget.label}`, actions.map((action) => action.label));
    if (choice == null) return;
    try { await actions[choice].run(); await refresh(); }
    catch (error) { deps.toast(error.message, "error"); }
  }

  async function createGroup() {
    const name = await deps.dialogs.openText("New widget group", "Group name");
    if (!name?.trim()) return;
    try {
      const data = await createPinnedWidgetGroup(deps.fetchImpl, { name, sessionId: sessionId() });
      deps.setCollection(data);
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function manageGroup(group) {
    const choice = await deps.dialogs.openOption(`Manage ${group.name}`, [
      "Rename",
      "Delete and ungroup widgets",
      "Delete group and all widgets",
    ]);
    if (choice == null) return;
    try {
      if (choice === 0) {
        const name = await deps.dialogs.openText("Rename widget group", "Group name", group.name);
        if (name?.trim()) await updatePinnedWidgetGroup(deps.fetchImpl, { id: group.id, name, sessionId: sessionId() });
      } else {
        await deletePinnedWidgetGroup(deps.fetchImpl, group.id, choice === 1 ? { ungroup: true } : { deleteWidgets: true });
      }
      await refresh();
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function pinHttpsLink() {
    const url = await deps.dialogs.openText("Pin HTTPS link", "https://…");
    if (!url?.trim()) return;
    const label = await deps.dialogs.openText("Link label", "Short label");
    try {
      const data = await pinLink(deps.fetchImpl, { url, label, sessionId: sessionId() });
      deps.setCollection(data);
    } catch (error) { deps.toast(error.message, "error"); }
  }

  async function reveal(widget) {
    if (!widget.path) return;
    deps.closeModal();
    const directory = widget.kind === "directory" ? widget.path : widget.path.slice(0, widget.path.lastIndexOf("/")) || "/";
    await deps.showFileExplorer(directory);
  }

  return Object.freeze({
    pinPath: pinArtifactPath,
    actions: Object.freeze({ open, manage, move, moveGroup, pinPath: pinArtifactPath, pinLink: pinHttpsLink, createGroup, renameGroup: manageGroup, reveal }),
  });
}
