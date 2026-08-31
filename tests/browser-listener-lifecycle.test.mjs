import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import test from "node:test";

const root = new URL("../public/src/", import.meta.url);

function sourceFiles(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory() ? sourceFiles(url) : /\.(?:js|svelte)$/.test(entry.name) ? [url] : [];
  });
}

test("every imperative browser or element listener module includes a cleanup path", () => {
  const listenerOwners = sourceFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /\.addEventListener(?:\?\.)?\(/.test(source)
      ? [{ path: relative(root.pathname, file.pathname), source }]
      : [];
  });

  assert.deepEqual(listenerOwners.map(({ path }) => path), [
    "features/cloud/cloudBrowser.js",
    "lib/commandController.js",
    "lib/fileExplorerController.js",
    "lib/modalDomAdapters.js",
    "lib/modalHistoryController.js",
    "lib/tutorialDomAdapters.js",
    "runtime/carouselController.js",
    "runtime/eventControllers.js",
    "runtime/registerServiceWorker.js",
    "runtime/transcriptRuntime.js",
  ]);
  for (const { path, source } of listenerOwners) {
    assert.match(source, /\.removeEventListener(?:\?\.)?\(/, `${path} must remove its imperative listeners`);
  }
});

test("observers and media-query listeners cannot bypass the owned listener inventory", () => {
  const unmanaged = sourceFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /\b(?:MutationObserver|ResizeObserver|IntersectionObserver)\b|\.matchMedia\([^\n]+\)\.addEventListener/.test(source)
      ? [relative(root.pathname, file.pathname)]
      : [];
  });
  assert.deepEqual(unmanaged, []);
});
