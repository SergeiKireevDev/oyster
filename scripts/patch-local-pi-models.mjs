#!/usr/bin/env node
/**
 * Compatibility patch for the pinned pi generator after models.dev renamed
 * kimi-for-coding to regional catalog keys. Keep the existing api.kimi.com
 * endpoint paired with the CN catalog; do not silently switch credential regions.
 * Applied only inside the Docker build, never to the source submodule checkout.
 * Remove once the pinned pi generator supports the renamed provider natively.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BEFORE = `\t\tif (data["kimi-for-coding"]?.models) {
\t\t\tconst kimiModels = data["kimi-for-coding"].models as Record<string, ModelsDevModel>;`;
const AFTER = `\t\tconst kimiCodingProvider = data["kimi-code-plan-cn"] ?? data["kimi-for-coding"];
\t\tif (kimiCodingProvider?.models) {
\t\t\tconst kimiModels = kimiCodingProvider.models as Record<string, ModelsDevModel>;`;

export function patchLocalPiModels(source) {
  if (source.includes(AFTER) && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2 || source.includes(AFTER)) {
    throw new Error("Unsupported pi model generator: review the Kimi catalog compatibility patch before building");
  }
  return source.replace(BEFORE, AFTER);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: patch-local-pi-models.mjs GENERATOR_PATH");
    const path = process.argv[2];
    const source = readFileSync(path, "utf8");
    const patched = patchLocalPiModels(source);
    if (patched !== source) writeFileSync(path, patched);
    console.log("Kimi model catalog compatibility patch ready");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
