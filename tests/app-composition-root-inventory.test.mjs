import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");

const BASELINE = Object.freeze({
  rootMutableBindings: 15,
  domAccessSites: 18,
  controllerConstructions: 44,
});

function count(pattern) {
  return [...source.matchAll(pattern)].length;
}

test("composition-root inventory rejects new root-owned mutable state", () => {
  const actual = count(/^let\s+[A-Za-z_$][\w$]*/gm);
  assert.ok(
    actual <= BASELINE.rootMutableBindings,
    `appCompositionRoot.js root mutable bindings grew from ${BASELINE.rootMutableBindings} to ${actual}`,
  );
});

test("composition-root inventory rejects new direct DOM access", () => {
  const actual = source
    .split("\n")
    .filter((line) => /\$\("|getElementById|querySelector|classList/.test(line))
    .length;
  assert.ok(
    actual <= BASELINE.domAccessSites,
    `appCompositionRoot.js DOM access sites grew from ${BASELINE.domAccessSites} to ${actual}`,
  );
});

test("composition-root inventory rejects new controller construction", () => {
  const actual = count(/^\s*(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*create[A-Z]/gm);
  assert.ok(
    actual <= BASELINE.controllerConstructions,
    `appCompositionRoot.js controller constructions grew from ${BASELINE.controllerConstructions} to ${actual}`,
  );
});
