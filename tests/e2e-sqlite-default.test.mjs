import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every Playwright scenario defaults to the local SQLite image", () => {
  const reset = source("tests/e2e/lib/reset.js");
  const setup = source("tests/e2e/global-setup.js");
  const runner = source("scripts/run-e2e-tests.sh");

  assert.match(reset, /process\.env\.OYSTER_IMAGE \?\? "oyster:sqlite"/);
  assert.match(reset, /selectedStore = "sqlite"/);
  assert.doesNotMatch(reset, /OYSTER_SQLITE_IMAGE|oyster:published|selectedStore = "jsonl"/);
  assert.match(setup, /"Dockerfile\.local-pi"/);
  assert.match(setup, /`pi-source=\$\{PI_SOURCE\}`/);
  assert.doesNotMatch(setup, /oyster:published|published JSONL/);
  assert.match(runner, /E2E_IMAGE="\$\{OYSTER_IMAGE:-oyster:sqlite\}"/);
  assert.match(runner, /docker build/);
  assert.match(runner, /--file "\$ROOT_DIR\/Dockerfile\.local-pi"/);
  assert.match(runner, /--build-context "pi-source=\$PI_SOURCE"/);
  assert.match(runner, /--tag "\$E2E_IMAGE"/);

  const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
  if (existsSync(workflowUrl)) {
    const workflow = readFileSync(workflowUrl, "utf8");
    assert.match(workflow, /name: Build SQLite E2E image/);
    assert.match(workflow, /file: Dockerfile\.local-pi/);
    assert.match(workflow, /tags:\s*\|[\s\S]*?\n\s+oyster:sqlite/);
  }
});
