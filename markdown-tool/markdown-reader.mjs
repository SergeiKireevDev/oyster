#!/usr/bin/env node
/** Render a Markdown file and serve the readable HTML on a local port. */

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_PREFIX = "\0TOKEN{";
const TOKEN_SUFFIX = "}\0";

function escapeHtml(value, quote = true) {
  let escaped = String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) escaped = escaped.replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  return escaped;
}

function unescapeHtml(value) {
  return String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity, name) => {
    const normalized = name.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    const codePoint = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try { return String.fromCodePoint(codePoint); } catch { return entity; }
  });
}

/** Allow ordinary links while blocking scriptable URL schemes. */
export function safeUrl(url) {
  const value = unescapeHtml(url).trim();
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return "#";
  return escapeHtml(value);
}

/** Render the inline constructs supported by the hublot reader. */
export function renderInline(input) {
  const tokens = [];
  const stash = (value) => {
    tokens.push(value);
    return `${TOKEN_PREFIX}${tokens.length - 1}${TOKEN_SUFFIX}`;
  };

  let text = String(input).replace(/(`+)(.+?)\1/g, (_match, _ticks, code) => stash(`<code>${escapeHtml(code.trim())}</code>`));
  text = escapeHtml(text, false);

  text = text.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+&quot;.*?&quot;)?\)/g, (_match, alt, url) => (
    stash(`<img src="${safeUrl(url)}" alt="${escapeHtml(unescapeHtml(alt))}">`)
  ));
  text = text.replace(/\[([^\]]+)\]\((\S+?)(?:\s+&quot;.*?&quot;)?\)/g, (_match, label, url) => (
    stash(`<a href="${safeUrl(url)}">${label}</a>`)
  ));
  text = text.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_match, url) => (
    stash(`<a href="${safeUrl(unescapeHtml(url))}">${url}</a>`)
  ));

  text = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, stars, underscores) => `<strong>${stars ?? underscores}</strong>`);
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g, (_match, stars, underscores) => `<em>${stars ?? underscores}</em>`);
  text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");

  tokens.forEach((value, index) => { text = text.replaceAll(`${TOKEN_PREFIX}${index}${TOKEN_SUFFIX}`, value); });
  return text;
}

function slugify(text, used) {
  const base = unescapeHtml(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((part) => part.trim());
}

/** Return rendered HTML, headings for a TOC, and the first H1. */
export function renderMarkdown(source) {
  const lines = String(source).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const output = [];
  const headings = [];
  const usedSlugs = new Set();
  let firstH1 = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = line.match(/^\s*(```+|~~~+)\s*([^ ]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2];
      const code = [];
      i += 1;
      const closeFence = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      while (i < lines.length && !closeFence.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
      output.push(`<pre><code${languageClass}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2];
      const plainLabel = label.replace(/[*_~`]+/g, "");
      const slug = slugify(plainLabel, usedSlugs);
      headings.push([level, plainLabel, slug]);
      if (level === 1 && firstH1 === null) firstH1 = plainLabel;
      output.push(`<h${level} id="${slug}">${renderInline(label)}<a class="anchor" href="#${slug}" aria-label="Link to this section">#</a></h${level}>`);
      i += 1;
      continue;
    }

    if (i + 1 < lines.length && line.trim() && /^\s*(=+|-+)\s*$/.test(lines[i + 1])) {
      const level = lines[i + 1].includes("=") ? 1 : 2;
      const label = line.trim();
      const slug = slugify(label, usedSlugs);
      headings.push([level, label, slug]);
      if (level === 1 && firstH1 === null) firstH1 = label;
      output.push(`<h${level} id="${slug}">${renderInline(label)}<a class="anchor" href="#${slug}" aria-label="Link to this section">#</a></h${level}>`);
      i += 2;
      continue;
    }

    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      output.push("<hr>");
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoted = [];
      while (i < lines.length && (lines[i].trimStart().startsWith(">") || !lines[i].trim())) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      output.push(`<blockquote>${renderMarkdown(quoted.join("\n")).html}</blockquote>`);
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]);
      const alignment = aligns.map((spec) => (
        spec.startsWith(":") && spec.endsWith(":") ? "center" : spec.endsWith(":") ? "right" : "left"
      ));
      output.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell, index) => `<th style="text-align:${alignment[index] ?? "left"}">${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>`);
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = splitTableRow(lines[i]);
        output.push(`<tr>${cells.map((cell, index) => `<td style="text-align:${alignment[index] ?? "left"}">${renderInline(cell)}</td>`).join("")}</tr>`);
        i += 1;
      }
      output.push("</tbody></table></div>");
      continue;
    }

    const listMatch = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
        if (task) {
          const checked = task[1].toLowerCase() === "x" ? " checked" : "";
          items.push(`<li class="task"><input type="checkbox" disabled${checked}> ${renderInline(task[2])}</li>`);
        } else {
          items.push(`<li>${renderInline(item[2])}</li>`);
        }
        i += 1;
      }
      output.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim()) {
      const candidate = lines[i];
      if (/^\s{0,3}(#{1,6})\s+/.test(candidate) || /^\s*(```+|~~~+)/.test(candidate)) break;
      if (/^\s{0,3}([-+*]|\d+[.)])\s+/.test(candidate) || candidate.trimStart().startsWith(">")) break;
      paragraph.push(candidate.trim());
      i += 1;
    }
    const joined = paragraph.join("\n").replace(/ {2,}\n/g, "<br>\n");
    output.push(`<p>${renderInline(joined).replaceAll("\n", " ")}</p>`);
  }

  return { html: output.join("\n"), headings, firstH1 };
}

export function makeToc(headings) {
  if (headings.length < 2) return "";
  const links = headings.map(([level, label, slug]) => (
    `<li class="level-${level}"><a href="#${slug}">${escapeHtml(label)}</a></li>`
  )).join("\n");
  return `<nav class="toc" aria-label="Table of contents"><strong>On this page</strong><ol>${links}</ol></nav>`;
}

function replaceTemplate(template, replacements) {
  let page = template;
  for (const marker of Object.keys(replacements)) {
    if (!page.includes(marker)) throw new Error(`Template is missing required marker: ${marker}`);
  }
  for (const [marker, replacement] of Object.entries(replacements)) page = page.replaceAll(marker, replacement);
  return page;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer between 1 and 65535");
  return port;
}

function usage() {
  return "Usage: markdown-reader.mjs <markdown> <port> [-o|--output <path>] [--host <host>] [--template <path>]";
}

export function parseArgs(argv) {
  const positional = [];
  const options = { host: "127.0.0.1", output: null, template: fileURLToPath(new URL("reader-template.html", import.meta.url)) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (["-o", "--output", "--host", "--template"].includes(arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      const key = arg === "-o" || arg === "--output" ? "output" : arg.slice(2);
      options[key] = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error(usage());
  return { ...options, markdown: positional[0], port: parsePort(positional[1]), help: false };
}

const MIME_TYPES = new Map([
  [".avif", "image/avif"], [".css", "text/css; charset=utf-8"], [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"], [".pdf", "application/pdf"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"], [".webp", "image/webp"],
]);

function isBelow(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

/** Create the HTTP server used by the deterministic Markdown hublot. */
export function createReaderServer(page, sourceDir, outputName) {
  const pageBytes = Buffer.from(page);
  const root = resolve(sourceDir);
  return createServer(async (request, response) => {
    try {
      if (!request.url || !["GET", "HEAD"].includes(request.method ?? "GET")) {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
      catch { response.writeHead(400).end("Bad request"); return; }

      if (pathname === "/" || pathname === `/${outputName}`) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": pageBytes.length,
          "Cache-Control": "no-cache",
        });
        response.end(request.method === "HEAD" ? undefined : pageBytes);
        return;
      }

      const assetPath = resolve(root, `.${pathname}`);
      if (!isBelow(root, assetPath)) { response.writeHead(403).end("Forbidden"); return; }
      const asset = await stat(assetPath);
      if (!asset.isFile()) { response.writeHead(404).end("Not found"); return; }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES.get(extname(assetPath).toLowerCase()) ?? "application/octet-stream",
        "Content-Length": asset.size,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(assetPath).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      const statusCode = error?.code === "ENOENT" || error?.code === "ENOTDIR" ? 404 : 500;
      if (!response.headersSent) response.writeHead(statusCode);
      response.end(statusCode === 404 ? "Not found" : "Internal server error");
    }
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return 0; }

  const markdownPath = resolve(args.markdown);
  const templatePath = resolve(args.template);
  const markdownInfo = await stat(markdownPath).catch(() => null);
  if (!markdownInfo?.isFile()) throw new Error(`Markdown file not found: ${args.markdown}`);
  const templateInfo = await stat(templatePath).catch(() => null);
  if (!templateInfo?.isFile()) throw new Error(`Template file not found: ${args.template}`);

  const markdownExtension = extname(markdownPath);
  const outputBase = markdownExtension && markdownExtension !== "."
    ? markdownPath.slice(0, -markdownExtension.length)
    : markdownPath;
  const outputPath = resolve(args.output ?? `${outputBase}.html`);
  const source = await readFile(markdownPath, "utf8");
  const rendered = renderMarkdown(source);
  const title = rendered.firstH1 ?? basename(markdownPath, extname(markdownPath)).replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const template = await readFile(templatePath, "utf8");
  const page = replaceTemplate(template, {
    "{{TITLE}}": escapeHtml(title),
    "{{SOURCE_NAME}}": escapeHtml(basename(markdownPath)),
    "{{TOC}}": makeToc(rendered.headings),
    "{{CONTENT}}": rendered.html,
    "{{RAW_MARKDOWN}}": escapeHtml(source),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, page, "utf8");
  const server = createReaderServer(page, dirname(markdownPath), basename(outputPath));
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, resolvePromise);
  });
  const displayHost = ["127.0.0.1", "0.0.0.0", "::"].includes(args.host) ? "localhost" : args.host;
  console.log(`Generated ${outputPath}`);
  console.log(`Serving http://${displayHost}:${args.port}/ (press Ctrl-C to stop)`);
  return new Promise((resolvePromise, reject) => {
    server.once("close", () => resolvePromise(0));
    server.once("error", reject);
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
