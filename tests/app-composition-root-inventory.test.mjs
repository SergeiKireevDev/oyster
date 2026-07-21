import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");

test("composition root imports assemblies and adapters instead of feature controller constructors", () => {
  assert.doesNotMatch(source, /\bcreate[A-Za-z0-9_$]*Controller\b/);
});

test("composition root owns no feature-local mutable bindings", () => {
  assert.doesNotMatch(source, /^\s*(?:let|var)\s/m);
  assert.doesNotMatch(source, /new\s+(?:Set|Map|WeakSet|WeakMap)\s*\(/);
});

test("composition root does not register feature action or browser listeners", () => {
  assert.doesNotMatch(source, /(?<!\.)\bconfigure[A-Za-z0-9_$]*Actions\s*\(/);
  assert.doesNotMatch(source, /\.(?:addEventListener|removeEventListener|dispatchEvent)\s*\(/);
});

test("composition root accesses feature elements only through injected DOM adapters", () => {
  assert.doesNotMatch(source, /\.(?:getElementById|querySelector|querySelectorAll|createElement)\s*\(/);
  assert.doesNotMatch(source, /\.classList\b/);
  assert.match(source, /createBrowserDomAdapters\(\{ documentTarget: document, findElement: find \}\)/);
  assert.match(source, /createLayoutDomAdapters\(/);
});
