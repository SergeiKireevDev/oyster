import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");

test("app contains no extracted filesystem route bodies or stale upload helpers", () => {
  for (const route of ["GET /browse", "POST /mkdir", "GET /file-download", "GET /file-content", "POST /file-save", "POST /file-upload", "POST /workdir"]) {
    assert.equal(source.includes(`"${route}":`), false, `stale route: ${route}`);
  }
  for (const stale of ["confinePath", "forbidden(res", "readRawBody", "createReadStream", "readFileSync", "appendFileSync", "renameSync"]) {
    assert.equal(source.includes(stale), false, `stale filesystem helper: ${stale}`);
  }
  assert.match(source, /file: fileRoutes/);
  assert.match(source, /workdir: workdirRoutes/);
});
