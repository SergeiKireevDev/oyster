import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function newestMtime(path) {
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(target));
    else newest = Math.max(newest, statSync(target).mtimeMs);
  }
  return newest;
}

/** Stable startup policy: only Oyster's default local pi build has a source freshness check. */
export function validateLocalPiBuild(piBin, defaultLocalPi) {
  if (piBin !== defaultLocalPi) return;
  const sourceRoot = resolve(dirname(piBin), "..", "src");
  if (!existsSync(sourceRoot)) throw new Error(`local pi source is missing: ${sourceRoot}`);
  if (newestMtime(sourceRoot) > statSync(piBin).mtimeMs) {
    throw new Error(`local pi build is stale: ${piBin}. Run npm run build:pi.`);
  }
}
