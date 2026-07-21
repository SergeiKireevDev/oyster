import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../public/src/", import.meta.url));
const componentRoot = join(sourceRoot, "components");

function files(directory, pattern) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path, pattern) : pattern.test(entry.name) ? [path] : [];
  });
}

const applicationSources = files(sourceRoot, /\.(?:js|svelte)$/).map((path) => ({
  path: relative(sourceRoot, path),
  source: readFileSync(path, "utf8"),
}));

const legacyEventNames = [
  ["pi", "menu", "action"].join("-"),
  ["pi", "command", "palette", "run"].join("-"),
];
const legacyDialogControllers = [
  ["configure", "Dialog", "Controller"].join(""),
  ["configure", "OptionPicker", "Controller"].join(""),
];

test("final UI boundary forbids global action events and dialog controller bridges", () => {
  for (const { path, source } of applicationSources) {
    for (const name of [...legacyEventNames, ...legacyDialogControllers]) {
      assert.equal(source.includes(name), false, `${path} must not reference ${name}`);
    }
  }
});

test("overlay host imports components and shell state, not feature actions", () => {
  const overlays = readFileSync(join(componentRoot, "Overlays.svelte"), "utf8");
  const importPaths = [...overlays.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);

  assert.equal(importPaths.some((path) => path.includes("/features/") || /Actions\.js$/.test(path)), false);
  assert.doesNotMatch(overlays, /\b(?:onclick|onkeydown|onsubmit)=/);
});

test("modal and overlay components do not emulate buttons with spans", () => {
  const modalComponents = files(componentRoot, /(?:Modal|Overlays)\.svelte$/);
  assert.ok(modalComponents.length > 0);

  for (const path of modalComponents) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /<span\b[^>]*\brole=["']button["']/i, relative(componentRoot, path));
  }
});
