#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".gitdocs_build");
const nodeOptions = [process.env.NODE_OPTIONS, "--openssl-legacy-provider"].filter(Boolean).join(" ");
const result = spawnSync("npx", ["--yes", "gitdocs@2.0.0", "build"], {
  cwd: root,
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const htmlFiles = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".html")) htmlFiles.push(path);
  }
}
walk(output);

const branding = [
  '<link rel="icon" type="image/svg+xml" href="/oyster.svg">',
  '<link rel="stylesheet" href="/oyster-docs.css">',
].join("");
for (const path of htmlFiles) {
  const html = readFileSync(path, "utf8");
  if (!html.includes("/oyster-docs.css")) {
    writeFileSync(path, html.replace("</head>", `${branding}</head>`));
  }
}
console.log(`Applied Oyster branding to ${htmlFiles.length} GitDocs pages.`);
