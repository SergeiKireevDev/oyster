#!/usr/bin/env node
// Record the real Playwright e2e suite instead of maintaining a second set of
// hand-written demo scenarios. This keeps recordings in sync with the tests:
// the same specs, fixtures, container lifecycle, and helpers are used.

import { spawnSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = process.env.E2E_VIDEO_OUT ?? join(ROOT, "preview-videos");
const RAW = process.env.E2E_VIDEO_DIR ?? join(OUT, "raw");
const DELAY_MS = process.env.E2E_ACTION_DELAY_MS ?? "1000";
const WORKERS = process.env.E2E_WORKERS ?? "1";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeRmDocker(pattern) {
  try {
    const names = sh(`docker ps -a --filter 'name=${pattern}' --format '{{.Names}}'`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length) sh(`docker rm -f ${names.map((n) => JSON.stringify(n)).join(" ")}`);
  } catch {}
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (name.endsWith(".webm")) out.push(path);
  }
  return out;
}

function slug(s) {
  return s
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 150) || "video";
}

function titleFromSlug(s) {
  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function writeGallery(files) {
  const generated = new Date().toLocaleString();
  const cards = files.map((file) => {
    const st = statSync(join(OUT, file));
    const title = titleFromSlug(file.replace(/\.webm$/, ""));
    return `<article class="card"><h2>${title}</h2><video controls preload="metadata" src="${file}"></video><p><a href="${file}" download>Download</a><span>${sizeText(st.size)}</span></p></article>`;
  }).join("\n");
  writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>pi-lot e2e videos</title>
<style>
:root{color-scheme:dark;--bg:#0f1115;--panel:#171a21;--border:#2a2f3a;--text:#e6e9ef;--muted:#8b93a3;--accent:#7aa2f7}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}header{position:sticky;top:0;z-index:2;background:rgba(15,17,21,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);padding:18px 22px}h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--muted)}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;padding:18px}.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.25)}h2{font-size:14px;margin:0 0 10px;color:var(--text);font-weight:650}video{width:100%;aspect-ratio:16/10;background:#000;border-radius:10px;border:1px solid #000}p{display:flex;justify-content:space-between;align-items:center;margin:8px 2px 0;color:var(--muted);font-size:12px}a{color:var(--accent);text-decoration:none}@media(max-width:520px){main{grid-template-columns:1fr;padding:10px}header{padding:14px}.card{padding:8px}}
</style></head><body><header><h1>pi-lot e2e test videos</h1><p>${files.length} recordings generated ${generated}</p></header><main>${cards}</main></body></html>`);
}

function main() {
  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(OUT)) {
    if (name.endsWith(".webm")) rmSync(join(OUT, name), { force: true });
  }
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  rmSync(join(HERE, ".port-locks"), { recursive: true, force: true });
  safeRmDocker("^pi-lot-e2e-[0-9]+$");

  console.log(`Recording e2e videos with E2E_ACTION_DELAY_MS=${DELAY_MS}, E2E_WORKERS=${WORKERS}`);
  const result = spawnSync("npx", ["playwright", "test"], {
    cwd: HERE,
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_VIDEO: "1",
      E2E_ACTION_DELAY_MS: DELAY_MS,
      E2E_VIDEO_DIR: RAW,
      E2E_WORKERS: WORKERS,
    },
  });

  const videos = walk(RAW).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const names = [];
  const used = new Set();
  for (const video of videos) {
    const parent = relative(RAW, dirname(video)).replace(/[/\\]/g, "-");
    let base = slug(parent.replace(/-chromium(?:-retry\d+)?$/i, ""));
    let name = `${base}.webm`;
    let n = 2;
    while (used.has(name)) name = `${base}-${n++}.webm`;
    used.add(name);
    copyFileSync(video, join(OUT, name));
    names.push(name);
  }
  writeGallery(names);

  console.log(`\nRecorded ${names.length} videos in ${OUT}:`);
  for (const name of names) console.log(`  ${name}`);
  console.log(`Gallery: ${join(OUT, "index.html")}`);

  safeRmDocker("^pi-lot-e2e-[0-9]+$");
  rmSync(join(HERE, ".port-locks"), { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

main();
