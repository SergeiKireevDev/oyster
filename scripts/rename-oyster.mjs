#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--check", "--help"].includes(arg))) {
  console.error("Usage: scripts/rename-oyster.mjs [--check]");
  process.exit(2);
}
if (args.has("--help")) {
  console.log("Rename legacy product names to oyster in every Git-tracked file.\n\nUse --check to report occurrences without changing files.");
  process.exit(0);
}

const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
});
if (rootResult.status !== 0) {
  process.stderr.write(rootResult.stderr);
  process.exit(rootResult.status ?? 1);
}
const root = rootResult.stdout.trim();
const filesResult = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "buffer",
  maxBuffer: 100 * 1024 * 1024,
});
if (filesResult.status !== 0) {
  process.stderr.write(filesResult.stderr);
  process.exit(filesResult.status ?? 1);
}

const separator = "-";
const legacyBase = ["pi", "lot"].join(separator);
const legacyUi = [legacyBase, "ui"].join(separator);
const replacement = "oyster";
const renames = [legacyUi, legacyBase].map((name) => ({
  needle: Buffer.from(name),
  replacement: Buffer.from(replacement),
}));
const files = filesResult.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

function replaceBytes(input, needle, replacementBytes) {
  const chunks = [];
  let count = 0;
  let cursor = 0;
  let match = input.indexOf(needle, cursor);
  while (match !== -1) {
    chunks.push(input.subarray(cursor, match), replacementBytes);
    cursor = match + needle.length;
    count += 1;
    match = input.indexOf(needle, cursor);
  }
  if (count === 0) return { output: input, count };
  chunks.push(input.subarray(cursor));
  return { output: Buffer.concat(chunks), count };
}

let changedFiles = 0;
let occurrences = 0;
for (const relativePath of files) {
  const path = resolve(root, relativePath);
  let contents = await readFile(path);
  let fileOccurrences = 0;
  for (const rename of renames) {
    const result = replaceBytes(contents, rename.needle, rename.replacement);
    contents = result.output;
    fileOccurrences += result.count;
  }
  if (fileOccurrences === 0) continue;

  changedFiles += 1;
  occurrences += fileOccurrences;
  if (!args.has("--check")) await writeFile(path, contents);
  console.log(`${args.has("--check") ? "found" : "updated"} ${relativePath} (${fileOccurrences})`);
}

if (args.has("--check")) {
  if (occurrences > 0) {
    console.error(`Found ${occurrences} legacy-name occurrence(s) in ${changedFiles} tracked file(s).`);
    process.exit(1);
  }
  console.log("No legacy product names found in tracked files.");
} else {
  console.log(`Replaced ${occurrences} occurrence(s) in ${changedFiles} tracked file(s).`);
}
