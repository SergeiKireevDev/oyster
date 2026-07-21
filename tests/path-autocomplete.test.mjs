import test from "node:test";
import assert from "node:assert/strict";
import { pathCompletionItems, pathCompletionRequest, pathTrigger } from "../public/src/lib/pathAutocomplete.js";

test("path trigger recognizes absolute and dot-relative tokens at the caret", () => {
  assert.deepEqual(pathTrigger({ value: "read ./src/ap", selectionStart: 13 }), { text: "./src/ap", start: 5 });
  assert.deepEqual(pathTrigger({ value: "/home/u later", selectionStart: 7 }), { text: "/home/u", start: 0 });
  assert.equal(pathTrigger({ value: "src/app", selectionStart: 7 }), null);
});

test("path completion resolves relative directories and filters files and folders", () => {
  const trigger = { text: "./src/co", start: 0 };
  const request = pathCompletionRequest(trigger.text, "/work");
  assert.deepEqual(request, { browsePath: "/work/src/", typedDir: "./src/", prefix: "co" });
  assert.deepEqual(pathCompletionItems(trigger, request, {
    path: "/work/src",
    dirs: [{ name: "components" }, { name: "lib" }],
    files: [{ name: "Composer.svelte" }, { name: "app.js" }],
  }), [
    { path: "./src/components/", name: "components", directory: true },
    { path: "./src/Composer.svelte", name: "Composer.svelte", directory: false },
  ]);
});

test("a leading slash offers confined absolute roots", () => {
  const trigger = { text: "/wo", start: 0 };
  const request = pathCompletionRequest(trigger.text, "/workspace");
  assert.deepEqual(request, { browsePath: "/workspace", typedDir: "/", prefix: "wo", allowedRoots: true });
  assert.deepEqual(pathCompletionItems(trigger, request, { path: "/workspace", home: "/root", dirs: [], files: [] }), [
    { path: "/workspace/", name: "workspace", directory: true },
  ]);
});
