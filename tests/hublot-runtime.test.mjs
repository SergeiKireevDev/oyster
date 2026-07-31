import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHublotRuntime } from "../public/src/features/hublots/createHublotRuntime.js";

test("hublot runtime exposes feature actions", () => {
  const runtime = createHublotRuntime({
    isVisible: () => true, getSessionId: () => null, resetCarousel() {}, openModal() {},
    createController: (deps) => ({ create() {}, refresh() {}, refreshSidebar() {} }),
    setDescription() {}, listSidebarHublots: () => [], updateTitle() {}, refreshRoutines() {},
  });
  assert.equal(typeof runtime.show, "function");
  assert.equal(typeof runtime.toggleScope, "function");
  assert.equal(typeof runtime.removeHublot, "function");
});

function createRemovalRuntime(overrides = {}) {
  return createHublotRuntime({
    isVisible: () => true,
    getSessionId: () => null,
    resetCarousel() {},
    openModal() {},
    createController: () => ({ create() {}, refresh() {}, refreshSidebar() {} }),
    setDescription() {},
    listSidebarHublots: () => [],
    updateTitle() {},
    refreshRoutines() {},
    toast() {},
    ...overrides,
  });
}

test("hublot runtime removal updates sidebar and manager stores after network success", async () => {
  const calls = [];
  const runtime = createRemovalRuntime({
    deleteHublot: async (id) => calls.push(["delete", id]),
    removeSidebarHublot: (id) => calls.push(["sidebar", id]),
    removeManagerHublot: (id) => calls.push(["manager", id]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await runtime.removeHublot("tunnel/id");

  assert.deepEqual(calls, [
    ["delete", "tunnel/id"],
    ["sidebar", "tunnel/id"],
    ["manager", "tunnel/id"],
  ]);
});

test("hublot runtime removal preserves stores and reports network failures", async () => {
  const calls = [];
  const runtime = createRemovalRuntime({
    deleteHublot: async () => { throw new Error("already closed"); },
    removeSidebarHublot: () => calls.push(["sidebar"]),
    removeManagerHublot: () => calls.push(["manager"]),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  await runtime.removeHublot("missing");

  assert.deepEqual(calls, [["toast", "close hublot failed: already closed", "error"]]);
});

test("live-interface widgets route workflows through scoped actions without eager iframes", () => {
  const sidebar = readFileSync(new URL("../public/src/components/HublotSidebar.svelte", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url), "utf8");

  assert.match(sidebar, /uiActions\.invoke\(HUBLOT_SHOW_ACTION\)/);
  assert.match(grid, /uiActions\.invoke\(PINNED_WIDGET_MANAGE_ACTION, widget\)/);
  assert.match(manager, /uiActions\.invoke\(HUBLOT_CREATE_ACTION, description\)/);
  assert.match(manager, /uiActions\.invoke\(HUBLOT_OPEN_COMMAND_PALETTE_ACTION, node\)/);
  assert.doesNotMatch(manager, /HUBLOT_TOGGLE_SCOPE_ACTION|HUBLOT_REMOVE_ACTION|hublot-grid/);
  assert.doesNotMatch(grid, /<iframe/);
  assert.doesNotMatch(manager, /<iframe/);
  assert.match(manager, /Waiting for Cloudflare/);
  for (const source of [sidebar, grid, manager]) {
    assert.doesNotMatch(source, /features\/hublots\/hublotActions\.js|removeHublot\(fetch|addToast/);
  }
});

test("hublot manager prevents duplicate submissions and cleans up its command palette binding", () => {
  const manager = readFileSync(new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(manager, /function submitHublot\(event\)/);
  assert.match(manager, /if \(\$hublotManager\.creating \|\| !\$hublotManager\.desc\.trim\(\)\) return/);
  assert.match(manager, /aria-busy=\{\$hublotManager\.creating\}/);
  assert.match(manager, /disabled=\{\$hublotManager\.creating \|\| !\$hublotManager\.desc\.trim\(\)\}/);
  assert.match(manager, /controller\?\.detach\?\.\(\)/);
  assert.match(manager, /<span class="spin" aria-hidden="true"><\/span>/);
  assert.match(manager, /<span role="status">Waiting for Cloudflare…<\/span>/);
  assert.doesNotMatch(manager, /onsubmit=\{\(event\) =>|oninput=\{\(event\) =>/);
  assert.match(manager, /<style>[\s\S]*?\.hublot-create-form\s*\{/);
  assert.doesNotMatch(styles, /\.hublot-create-form|\.hublot-description(?:\s|\{|,)/);
});
