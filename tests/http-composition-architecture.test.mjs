import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");

test("HTTP composition root owns no method/path route literals", () => {
  assert.deepEqual(source.match(/["'`](?:GET|POST|PATCH|DELETE) \/[^"'`]*["'`]/g) ?? [], []);
});

test("HTTP composition root has no direct filesystem or process policy imports", () => {
  const nodeImports = [...source.matchAll(/import \{([^}]+)\} from "node:(fs|child_process)";/g)]
    .map((match) => ({ names: match[1].trim(), module: match[2] }));
  // statSync is the single documented loader dependency: it supplies the mtime
  // query used to bypass ESM caching before disposable modules are constructed.
  assert.deepEqual(nodeImports, [{ names: "statSync", module: "fs" }]);
  assert.equal(source.includes('from "node:child_process"'), false);
});
