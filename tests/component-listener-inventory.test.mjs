import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("../public/src/", import.meta.url);

function svelteFiles(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory() ? svelteFiles(url) : entry.name.endsWith(".svelte") ? [url] : [];
  });
}

function source(file) {
  return readFileSync(file, "utf8");
}

function locations(pattern) {
  return svelteFiles().flatMap((file) => source(file).split("\n").flatMap((line, index) =>
    pattern.test(line) ? [`${relative(root.pathname, file.pathname)}:${index + 1}:${line.trim()}`] : []));
}

test("component browser and imperative listener inventory is explicit", () => {
  assert.deepEqual(locations(/\b(?:document|window)\b|\.(?:add|remove)EventListener\(/), [
    "components/Menu.svelte:24:<svelte:document onclick={close} />",
    "components/OptionPickerModal.svelte:48:<svelte:document onkeydowncapture={onKey} />",
  ]);

  const transcript = source(new URL("components/Transcript.svelte", root));
  assert.match(transcript, /onMount\(\(\) => \{/);
  assert.match(transcript, /return \(\) => clearInterval\(timer\);/);
  assert.doesNotMatch(source(new URL("components/OptionPickerModal.svelte", root)), /document\.(?:add|remove)EventListener/);
});

test("Svelte-managed document and element integrations stay on the approved list", () => {
  const integrations = locations(/<svelte:(?:document|window)\b|\buse:[\w]+/)
    .map((location) => location.replace(/:\d+:/, ":"));

  assert.deepEqual(integrations, [
    "components/CredentialsModal.svelte:use:trackOAuthInput",
    "components/FolderBrowserModal.svelte:use:focusOnMount",
    "components/HublotManagerModal.svelte:use:commandPalette",
    "components/Menu.svelte:<svelte:document onclick={close} />",
    "components/OptionPickerItem.svelte:use:scrollIntoViewWhen={active}",
    "components/OptionPickerItem.svelte:use:scrollIntoViewWhen={active}",
    "components/OptionPickerModal.svelte:<svelte:document onkeydowncapture={onKey} />",
    "components/Overlays.svelte:use:modalKeyboardNavigation={{ isOpen: () => $modalState.open, content: () => $modalState.content }}",
    "components/Overlays.svelte:use:modalFocusManagement={{ open: $modalState.open, identity: $modalState.content }}",
    "components/PinnedWidgetGrid.svelte:<span class={`pinned-widget-icon kind-${widget.kind}`} aria-hidden=\"true\" use:monitorPreview={widget}>",
    "components/SessionPickerModal.svelte:use:focusOnMount",
    "components/transcript/AssistantMessage.svelte:<div class=\"assistant-entry\" class:empty={isEmptyMessage()} data-role={role} bind:this={root} use:reportNode={onRoot}>",
    "components/transcript/UserMessage.svelte:<details class=\"block tool\" class:ckpt-frozen={!!restore} data-role=\"user\" bind:this={root} use:reportNode={onRoot}>",
    "components/transcript/UserMessage.svelte:<div class=\"message-row user-message-row\" data-role=\"user\" bind:this={root} use:reportNode={onRoot}>",
  ]);
});
