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
  assert.ok(grid.indexOf("{#each builtinWidgets") < grid.indexOf("{#each visibleGroups"));
  assert.ok(grid.indexOf("{#each visibleGroups") < grid.indexOf("{#each movableWidgets"));
  assert.doesNotMatch(grid, /!children\.length[^\n]*<FolderIcon/);
  assert.match(grid, /onpointerdown=\{\(event\) => touchPointerDown\(event, widget\)\}/);
  assert.match(grid, /ownerDocument\.elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(grid, /touchDropGroupId/);
  assert.match(styles, /\.pinned-widget-grid\s*\{[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(styles, /\.pinned-widget-cell\[draggable="true"\] \.pinned-widget-icon \{[\s\S]*touch-action: none;/);
  assert.match(styles, /\.pinned-widget-group-cell\.touch-drop-target/);
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
  assert.match(markdown, /renderMarkdown/);
  assert.match(html, /<iframe/);
  assert.match(html, /sandbox=""/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(markdown, /<article class="pinned-markdown-viewer" aria-label=\{label\}/);
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
