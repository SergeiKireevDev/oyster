import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLocalPiBuild } from "../server/startup/piBuildCheck.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-pi-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "dist", "cli.js");
  mkdirSync(join(root, "dist"));
  writeFileSync(bin, "// build");
  utimesSync(bin, 200, 200);
  return { root, bin };
}

test("external pi executables bypass local source freshness policy", () => {
  assert.doesNotThrow(() => validateLocalPiBuild("/external/pi", "/local/dist/cli.js"));
});

test("local source must exist", (t) => {
  const { bin } = fixture(t);
  assert.throws(() => validateLocalPiBuild(bin, bin), /local pi source is missing/);
});

test("nested sources newer than the CLI fail with actionable build guidance", (t) => {
  const { root, bin } = fixture(t);
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  const source = join(root, "src", "nested", "module.ts");
  writeFileSync(source, "// source");
  utimesSync(source, 300, 300);
  assert.throws(() => validateLocalPiBuild(bin, bin), /local pi build is stale: .*Run npm run build:pi\./);
  utimesSync(source, 100, 100);
  assert.doesNotThrow(() => validateLocalPiBuild(bin, bin));
  utimesSync(source, 200, 200);
  assert.doesNotThrow(() => validateLocalPiBuild(bin, bin));
});

test("empty sources and filesystem errors keep their original behavior", (t) => {
  const { root, bin } = fixture(t);
  mkdirSync(join(root, "src"));
  assert.doesNotThrow(() => validateLocalPiBuild(bin, bin));
  rmSync(bin);
  assert.throws(() => validateLocalPiBuild(bin, bin), { code: "ENOENT" });
});
