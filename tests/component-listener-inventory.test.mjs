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
    "App.svelte:28:rootElement: document.documentElement,",
    "App.svelte:29:themeColorElement: document.querySelector('meta[name=\"theme-color\"]'),",
    "App.svelte:40:const browserActions = provideBrowserActions(createBrowserActions({ windowTarget: window }));",
    "components/Menu.svelte:23:<svelte:document onclick={close} />",
    "components/OptionPickerModal.svelte:42:<svelte:document onkeydowncapture={onKey} />",
  ]);

  const transcript = source(new URL("components/Transcript.svelte", root));
  assert.match(transcript, /onMount\(\(\) => \{/);
  assert.match(transcript, /return \(\) => clearInterval\(timer\);/);
  assert.doesNotMatch(source(new URL("components/OptionPickerModal.svelte", root)), /document\.(?:add|remove)EventListener/);
});

test("Svelte-managed document and element integrations stay on the approved list", () => {
  assert.deepEqual(locations(/<svelte:(?:document|window)\b|\buse:[\w]+/), [
    "components/CredentialsModal.svelte:204:use:trackOAuthInput",
    "components/FolderBrowserModal.svelte:50:use:focusOnMount",
    "components/HublotManagerModal.svelte:84:use:commandPalette",
    "components/Menu.svelte:23:<svelte:document onclick={close} />",
    "components/OptionPickerModal.svelte:42:<svelte:document onkeydowncapture={onKey} />",
    "components/SessionPickerModal.svelte:100:use:focusOnMount",
  ]);
});
