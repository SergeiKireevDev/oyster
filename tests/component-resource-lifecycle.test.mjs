import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const componentsRoot = new URL("../public/src/components/", import.meta.url);

function componentFiles(directory = componentsRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

test("component timers and animation frames have lifecycle-owned cancellation", () => {
  const resourcePairs = [
    ["setTimeout", "clearTimeout"],
    ["setInterval", "clearInterval"],
    ["requestAnimationFrame", "cancelAnimationFrame"],
  ];
  const violations = [];

  for (const file of componentFiles()) {
    const source = readFileSync(file, "utf8");
    const name = relative(componentsRoot.pathname, file.pathname);
    for (const [acquire, release] of resourcePairs) {
      if (!source.includes(`${acquire}(`)) continue;
      if (!source.includes(`${release}(`)) violations.push(`${name} acquires ${acquire} without ${release}`);
      if (!/\bon(?:Mount|Destroy)\s*\(/.test(source)) violations.push(`${name} acquires ${acquire} outside a lifecycle owner`);
    }
  }

  assert.deepEqual(violations, []);
});

test("debounced session search and toast transition work are cancelled on destroy", () => {
  const picker = readFileSync(new URL("SessionPickerModal.svelte", componentsRoot), "utf8");
  const toast = readFileSync(new URL("ToastItem.svelte", componentsRoot), "utf8");

  assert.match(picker, /onDestroy\(\(\) => clearTimeout\(debounce\)\)/);
  assert.match(toast, /onDestroy\(\(\) => \{[\s\S]*for \(const timer of timers\) clearTimeout\(timer\);[\s\S]*timers\.clear\(\);/);
  assert.equal(toast.match(/\bsetTimeout\(/g)?.length, 1, "toast delays must go through its owned scheduler");
});
