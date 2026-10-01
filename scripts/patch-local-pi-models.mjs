#!/usr/bin/env node
/**
 * Compatibility patches for the pinned pi build and changing model catalogs:
 * - Keep api.kimi.com paired with the renamed CN catalog, not another region.
 * - Declare Fireworks' supported APIs independently of the generated models.
 * Applied before bundled pi builds and inside Docker build copies.
 * Remove each patch once the pinned pi source incorporates its fix.
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

const FIREWORKS_BEFORE = `export function fireworksProvider(): Provider<"anthropic-messages" | "openai-completions"> {
\treturn createProvider({`;
const FIREWORKS_AFTER = `export function fireworksProvider(): Provider<"anthropic-messages" | "openai-completions"> {
\treturn createProvider<"anthropic-messages" | "openai-completions">({`;

export function patchFireworksProvider(source) {
  if (source.includes(FIREWORKS_AFTER) && !source.includes(FIREWORKS_BEFORE)) return source;
  if (source.split(FIREWORKS_BEFORE).length !== 2 || source.includes(FIREWORKS_AFTER)) {
    throw new Error("Unsupported pi Fireworks provider: review the API type compatibility patch before building");
  }
  return source.replace(FIREWORKS_BEFORE, FIREWORKS_AFTER);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: patch-local-pi-models.mjs GENERATOR_PATH FIREWORKS_PROVIDER_PATH");
    // Validate both inputs before writing either, so source drift fails closed.
    const patches = [patchLocalPiModels, patchFireworksProvider].map((patch, index) => {
      const path = process.argv[index + 2];
      const source = readFileSync(path, "utf8");
      return { path, source, patched: patch(source) };
    });
    for (const { path, source, patched } of patches) {
      if (patched !== source) writeFileSync(path, patched);
    }
    console.log("Kimi catalog and Fireworks API compatibility patches ready");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
