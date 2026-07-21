import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const server = readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const e2eReadme = readFileSync(new URL("./e2e/README.md", import.meta.url), "utf8");

test("all runtime contracts require Node 22.19 for the application SQLite store", () => {
  assert.equal(packageJson.engines.node, ">=22.19.0");
  assert.equal(packageLock.packages[""].engines.node, ">=22.19.0");
  assert.match(server, /const MIN_NODE_VERSION = \[22, 19, 0\]/);
  assert.match(server, /oyster requires Node\.js >=/);
  assert.doesNotMatch(server, /if \(config\.PERSISTENT_STORE === "sqlite"\)[\s\S]*?Node\.js/);
  for (const document of [readme, agents, e2eReadme]) assert.match(document, /Node(?:\.js)?\s*(?:≥|>=)\s*22\.19/);
});
