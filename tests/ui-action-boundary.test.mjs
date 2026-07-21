import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../public/src/", import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:js|svelte)$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles(sourceRoot).map((path) => ({
  path: relative(sourceRoot, path),
  source: readFileSync(path, "utf8"),
}));

test("global menu and command-palette custom event paths are removed", () => {
  const removedEvents = [["pi", "menu", "action"], ["pi", "command", "palette", "run"]]
    .map((parts) => parts.join("-"));
  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /window\.dispatchEvent/, path);
    for (const eventName of removedEvents) assert.equal(source.includes(eventName), false, path);
  }
});

test("remaining dispatchEvent calls are native composer input synchronization", () => {
  const dispatches = sources.flatMap(({ path, source }) =>
    [...source.matchAll(/^.*\.dispatchEvent\(.*$/gm)].map((match) => ({ path, call: match[0].trim() })),
  );
  assert.deepEqual(dispatches, [
    { path: "features/composer/createComposerAssembly.js", call: 'input.dispatchEvent(new Event("input"));' },
    { path: "features/composer/createComposerAssembly.js", call: 'element.dispatchEvent(new Event("input"));' },
  ]);
});
