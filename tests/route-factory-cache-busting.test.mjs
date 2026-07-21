import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const source = readFileSync(new URL("../server/app.mjs", import.meta.url), "utf8");

test("app cache-busts every extracted route-factory import", () => {
  for (const name of ["openRoutes", "staticRoutes", "runnerRoutes", "sessionRoutes", "fileRoutes", "workdirRoutes", "tunnelRoutes", "routineRoutes", "checkpointRoutes"]) {
    assert.ok(source.includes(`"${name}"`), `missing dynamic route factory ${name}`);
    assert.equal(source.includes(`from "./http/routes/${name}.mjs"`), false);
  }
  assert.match(source, /\.map\(\(name\) => `http\/routes\/\$\{name\}\.mjs`\)/);
  assert.match(source, /\.map\(\(name\) => import\(bust\(name\)\)\)/);
});

test("mtime query observes a changed route module across application-style reloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "route-cache-bust-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const route = join(root, "route.mjs");
  const load = async () => {
    const info = await stat(route);
    return import(`${pathToFileURL(route)}?v=${info.mtimeMs}`);
  };
  await writeFile(route, 'export const response = "before";\n');
  assert.equal((await load()).response, "before");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(route, 'export const response = "after";\n');
  assert.equal((await load()).response, "after");
});
