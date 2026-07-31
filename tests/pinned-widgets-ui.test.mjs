import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPinnedWidgetRuntime } from "../public/src/features/pinned-widgets/createPinnedWidgetRuntime.js";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("right rail is a compact grouped Pinned Widgets launcher", () => {
  const sidebar = component("HublotSidebar.svelte");
  const grid = component("PinnedWidgetGrid.svelte");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(sidebar, />Pinned Widgets</);
  assert.match(sidebar, /<PinnedWidgetGrid/);
  assert.match(grid, /pinnedWidgetActiveGroup/);
  assert.match(grid, /PINNED_WIDGET_MOVE_ACTION/);
  assert.match(grid, /pinned-widget-group-icon/);
  assert.match(grid, /draggable=\{widget\.kind !== "builtin"\}/);
  assert.match(grid, /title: "Workspace visible"/);
  assert.match(grid, /description: "All sessions in this workspace"/);
  assert.match(grid, /title: "Session only"/);
  assert.match(grid, /description: "Only this session · default"/);
  assert.ok(grid.indexOf('scope: "workspace"') < grid.indexOf('scope: "session"'));
  assert.match(grid, /application\/x-oyster-widget-group/);
  assert.match(grid, /PINNED_WIDGET_MOVE_GROUP_ACTION/);
  assert.match(grid, /dragStartGroup\(event, group\)/);
  assert.ok(grid.indexOf("{#each section.builtinWidgets") < grid.indexOf("{#each section.groups"));
  assert.ok(grid.indexOf("{#each section.groups") < grid.indexOf("{#each section.movableWidgets"));
  assert.doesNotMatch(grid, /!children\.length[^\n]*<FolderIcon/);
  assert.match(grid, /onpointerdown=\{\(event\) => touchPointerDown\(event, widget\)\}/);
  assert.match(grid, /touchMoveFrame\.schedule\(event\.pointerId, event\.currentTarget\.ownerDocument, event\.clientX, event\.clientY\)/);
  assert.match(grid, /documentTarget\.elementFromPoint\(x, y\)/);
  assert.match(grid, /touchDestination/);
  assert.match(grid, /data-scope=\{section\.scope\}/);
  assert.match(grid, /PINNED_WIDGET_MOVE_ACTION, \{ id, scope, groupId, beforeId \}/);
  assert.match(styles, /\.pinned-widget-grid\s*\{[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(styles, /\.pinned-widget-cell\[draggable="true"\] \.pinned-widget-icon \{[\s\S]*touch-action: none;/);
  assert.match(styles, /\.pinned-widget-group-cell\.touch-drop-target/);
  assert.match(styles, /\.pinned-widget-section\.touch-drop-target/);
  assert.match(styles, /\.pinned-widget-icon\s*\{[\s\S]*width: 50px;[\s\S]*height: 50px;/);
});

test("pinned widget rail keeps creation compact and nests group destinations under Move to", async () => {
  const sidebar = component("HublotSidebar.svelte");
  assert.doesNotMatch(sidebar, />Group<|>Link</);
  assert.match(sidebar, /id="hublotAdd"[^>]*>Add custom from prompt<\/button>/);

  const prompts = [];
  const requests = [];
  const choices = [1, 1];
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => "session-1",
    getGroups: () => [
      { id: "group-a", name: "Alpha", scope: "session" },
      { id: "group-b", name: "Beta", scope: "session" },
    ],
    dialogs: {
      openOption: async (title, options) => {
        prompts.push({ title, options });
        return choices.shift();
      },
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    load: async () => {},
  });

  await runtime.actions.manage({ id: "widget-1", label: "Report", kind: "markdown", scope: "session", groupId: "group-a" });
  assert.deepEqual(prompts, [
    { title: "Manage Report", options: ["Rename", "Move to", "Unpin"] },
    { title: "Move Report to", options: ["Top level", "Beta"] },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].options.body).groupId, "group-b");
});

test("dragging a widget between visibility sections updates its scope", async () => {
  const requests = [];
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => "session-1",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    load: async () => {},
  });

  await runtime.actions.move({ id: "widget-1", scope: "workspace", groupId: null, beforeId: null });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    id: "widget-1", scope: "workspace", groupId: null, beforeId: null, sessionId: "session-1",
  });
});

test("dragging a group between visibility sections moves the group scope", async () => {
  const requests = [];
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => "session-1",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    load: async () => {},
  });

  await runtime.actions.moveGroup({ id: "group-1", scope: "session" });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    id: "group-1", scope: "session", sessionId: "session-1",
  });
});

test("standalone HTML opens its streaming viewer without buffering the artifact as JSON", async () => {
  const modals = [];
  let fetched = false;
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => "session-1",
    fetchImpl: async () => { fetched = true; throw new Error("HTML must not be fetched as text"); },
    openModal: (modal) => modals.push(modal),
  });

  const widget = {
    id: "widget-html", label: "Large report", kind: "file", availability: "ready",
    mimeType: "text/html; charset=utf-8",
  };
  await runtime.actions.open(widget);
  assert.equal(fetched, false);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].context.widget, widget);
});

test("group management can delete the group together with all of its widgets", async () => {
  const requests = [];
  const runtime = createPinnedWidgetRuntime({
    getSessionId: () => "session-1",
    dialogs: { openOption: async (title, options) => {
      assert.equal(title, "Manage Results");
      assert.deepEqual(options, ["Rename", "Delete and ungroup widgets", "Delete group and all widgets"]);
      return 2;
    } },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    load: async () => {},
  });

  await runtime.actions.renameGroup({ id: "group-1", name: "Results" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "DELETE");
  assert.match(requests[0].url, /deleteWidgets=1/);
});

test("Markdown raster images SVG vectors and video use native Svelte artifact displays", () => {
  const viewer = component("PinnedWidgetViewerModal.svelte");
  const markdown = component("MarkdownArtifact.svelte");
  const sanitizedMarkdown = component("SanitizedMarkdown.svelte");
  const html = component("HtmlArtifact.svelte");
  const image = component("ImageArtifact.svelte");
  const svg = component("SvgArtifact.svelte");
  const video = component("VideoArtifact.svelte");
  assert.match(viewer, /<MarkdownArtifact/);
  assert.match(viewer, /<HtmlArtifact/);
  assert.match(viewer, /<ImageArtifact/);
  assert.match(viewer, /widget\.mimeType === "image\/svg\+xml"/);
  assert.match(viewer, /<SvgArtifact/);
  assert.match(viewer, /<VideoArtifact/);
  assert.match(markdown, /<SanitizedMarkdown/);
  assert.match(sanitizedMarkdown, /renderSanitizedMarkdown/);
  assert.match(html, /<iframe/);
  assert.match(html, /\{src\}/);
  assert.match(html, /sandbox=""/);
  assert.doesNotMatch(html, /srcdoc/);
  assert.match(viewer, /browserActions\.pinnedWidgetHtmlSource\(widget\.id\)/);
  assert.match(markdown, /element="article" className="pinned-markdown-viewer"/);
  assert.match(viewer, /class:markdown-stage=\{widget\.kind === "markdown"\}/);
  assert.match(viewer, /copyTextToClipboard\(String\(widget\.content \?\? ""\)\)/);
  assert.match(viewer, /"Copy raw"/);
  assert.match(viewer, /pinned-markdown-toolbar/);
  const overlays = component("Overlays.svelte");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(overlays, /class:markdown-reader-modal=/);
  assert.match(styles, /#modal\.markdown-reader-modal[^}]*max-width: 1120px/);
  assert.match(styles, /\.pinned-markdown-viewer\s*\{[\s\S]*width: min\(100%, 78ch\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*#modal\.markdown-reader-modal[^}]*100dvh/);
  assert.match(image, /<img \{src\} \{alt\}/);
  assert.match(svg, /SVG remains in the browser's inert image context/);
  assert.match(svg, /<img \{src\} \{alt\}/);
  assert.match(video, /<video/);
  assert.match(video, /controls=\{!thumbnail\}/);
  for (const source of [viewer, markdown, image, svg, video]) assert.doesNotMatch(source, /<iframe/);
});

test("file explorer pins files and directories through scoped actions", () => {
  const explorer = component("FileExplorerModal.svelte");
  const directories = component("BrowserDirectoryList.svelte");
  assert.match(explorer, /FILE_EXPLORER_PIN_ACTION/);
  assert.match(explorer, /pinExploredPath\(fullPath\)/);
  assert.match(explorer, /Pin folder/);
  assert.match(directories, /export let onPin = null/);
  assert.match(directories, /onPin\(fullPath\)/);
});

test("live interface tiles never execute eager iframe previews", () => {
  assert.doesNotMatch(component("PinnedWidgetGrid.svelte"), /<iframe/);
  assert.doesNotMatch(component("HublotManagerModal.svelte"), /<iframe/);
  assert.match(component("PinnedWidgetGrid.svelte"), /status-\$\{widget\.availability\}/);
});
