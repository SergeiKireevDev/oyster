import katex from "katex";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
}

// ------------------------------------------------------------ syntax highlighting
// Tokenizes raw source, escapes each piece, wraps tokens in .tok-* spans.

const KEYWORDS = {
  js: "const let var function return if else for while do switch case break continue new class extends implements interface import export from default async await try catch finally throw typeof instanceof in of delete void yield static super this enum type namespace declare readonly public private protected abstract satisfies as keyof infer",
  py: "def return if elif else for while in not and or import from as class try except finally with lambda yield global nonlocal pass break continue raise assert del is async await match case print",
  sh: "if then else elif fi for while until do done case esac function in select echo exit return local export declare source alias set unset shift trap read printf cd test sudo",
  go: "func return if else for range switch case default break continue goto package import type struct interface map chan go defer select const var fallthrough nil make new len cap append",
  rust: "fn let mut return if else for while loop match impl struct enum trait use mod pub crate super const static ref move async await dyn box where unsafe extern type as in break continue",
  sql: "select from where insert update delete into values join left right inner outer full cross on group by order limit offset having as and or not null create table view index drop alter add primary foreign key references union all distinct case when then else end exists between like is in",
  c: "if else for while do switch case break continue return goto struct union enum typedef sizeof static extern const volatile inline void int char float double long short unsigned signed bool auto class public private protected virtual template typename namespace using new delete this nullptr try catch throw final override",
};
for (const [alias, base] of Object.entries({
  ts: "js", jsx: "js", tsx: "js", javascript: "js", typescript: "js", json: "js", solidity: "js", java: "c",
  python: "py", bash: "sh", shell: "sh", zsh: "sh", sh: "sh", console: "sh", golang: "go",
  cpp: "c", cc: "c", h: "c", hpp: "c", cs: "c", kotlin: "c", swift: "c",
})) KEYWORDS[alias] = KEYWORDS[base];

const LITERALS = new Set("true false null undefined None True False nil NULL Some Ok Err self".split(" "));

function highlightCode(src, lang) {
  lang = (lang || "").toLowerCase();
  const kwSet = new Set((KEYWORDS[lang] ?? KEYWORDS.js).split(" "));
  const hashComments = ["py", "python", "sh", "bash", "shell", "zsh", "console", "yaml", "yml", "toml", "rb", "ruby", "dockerfile", "makefile", ""].includes(lang);
  const dashComments = ["sql", "lua", "hs", "haskell"].includes(lang);
  const slashComments = !["py", "python", "yaml", "yml", "toml", "rb", "ruby"].includes(lang);
  const parts = [
    slashComments ? String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*` : null,
    hashComments ? String.raw`#[^\n]*` : null,
    dashComments ? String.raw`--[^\n]*` : null,
    String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''`,
    String.raw`"(?:\\.|[^"\\\n])*"`,
    String.raw`'(?:\\.|[^'\\\n])*'`,
    "`(?:\\\\.|[^`\\\\])*`",
    String.raw`\b0[xX][0-9a-fA-F_]+n?\b`,
    String.raw`\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\w*`,
    String.raw`[A-Za-z_$][A-Za-z0-9_$]*`,
  ].filter(Boolean);
  const re = new RegExp(parts.join("|"), "g");
  let out = "", pos = 0, m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(pos, m.index));
    const t = m[0];
    const c0 = t[0];
    let cls = null;
    if ((c0 === "/" && (t[1] === "/" || t[1] === "*")) || c0 === "#" || (c0 === "-" && t[1] === "-")) cls = "com";
    else if (c0 === '"' || c0 === "'" || c0 === "`") cls = "str";
    else if (c0 >= "0" && c0 <= "9") cls = "num";
    else if (c0 === "$") cls = "var";
    else if (kwSet.has(t)) cls = "kw";
    else if (LITERALS.has(t)) cls = "lit";
    else {
      let j = m.index + t.length;
      while (src[j] === " ") j++;
      if (src[j] === "(") cls = "fn";
    }
    out += cls ? `<span class="tok-${cls}">${escapeHtml(t)}</span>` : escapeHtml(t);
    pos = m.index + t.length;
  }
  return out + escapeHtml(src.slice(pos));
}

function decodeEscapedMath(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function renderMath(expression, displayMode = false) {
  return katex.renderToString(decodeEscapedMath(expression).trim(), {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}

function inlineMd(s) {
  // s is already HTML-escaped. Protect generated code/math HTML from the
  // emphasis and link replacements that follow.
  const protectedHtml = [];
  const protect = (html) => `\u0000PIHTML${protectedHtml.push(html) - 1}\u0000`;
  let rendered = s
    .replace(/`([^`]+)`/g, (_, code) => protect(`<code>${code}</code>`))
    .replace(/\\\((.+?)\\\)/g, (_, expression) => protect(renderMath(expression)))
    .replace(/(^|[^$\\])\$([^$\n]+?)\$(?!\$)/g, (_, prefix, expression) => `${prefix}${protect(renderMath(expression))}`)
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  rendered = rendered.replace(/\u0000PIHTML(\d+)\u0000/g, (_, index) => protectedHtml[Number(index)]);
  return rendered;
}

function renderMarkdown(src) {
  const lines = src.split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inlineMd(escapeHtml(para.join("\n"))).replace(/\n/g, "<br>")}</p>`); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      flushPara();
      const lang = fence[1].trim().split(/\s+/)[0] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : "";
      out.push(`<div class="codeblock">${label}<pre><code>${highlightCode(buf.join("\n"), lang)}</code></pre></div>`);
      continue;
    }
    const mathFence = line.match(/^\s*(\$\$|\\\[)\s*(.*?)\s*(?:\$\$|\\\])?\s*$/);
    if (mathFence) {
      const opener = mathFence[1];
      const closer = opener === "$$" ? "$$" : "\\]";
      const sameLineClosed = opener === "$$"
        ? /^\s*\$\$.+?\$\$\s*$/.test(line)
        : /^\s*\\\[.+?\\\]\s*$/.test(line);
      if (sameLineClosed) {
        flushPara();
        const expression = line.trim().slice(opener.length, -closer.length);
        out.push(`<div class="math-block">${renderMath(escapeHtml(expression), true)}</div>`);
        i++;
        continue;
      }
      if (line.trim() === opener) {
        flushPara();
        const buf = [];
        i++;
        while (i < lines.length && lines[i].trim() !== closer) { buf.push(lines[i]); i++; }
        if (i < lines.length) i++;
        out.push(`<div class="math-block">${renderMath(escapeHtml(buf.join("\n")), true)}</div>`);
        continue;
      }
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); out.push(`<h${h[1].length}>${inlineMd(escapeHtml(h[2]))}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${inlineMd(escapeHtml(buf.join("\n"))).replace(/\n/g, "<br>")}</blockquote>`);
      continue;
    }
    const ul = line.match(/^(\s*)([-*+])\s+(.*)$/);
    const ol = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const items = [];
      const re = ordered ? /^(\s*)(\d+)[.)]\s+(.*)$/ : /^(\s*)([-*+])\s+(.*)$/;
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (m) { items.push(m[3]); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += "\n" + lines[i].trim(); i++; }
        else if (/^\s*$/.test(lines[i])) {
          let next = i + 1;
          while (next < lines.length && /^\s*$/.test(lines[next])) next++;
          if (next < lines.length && re.test(lines[next])) i = next;
          else break;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      const start = ordered && ol[2] !== "1" ? ` start="${ol[2]}"` : "";
      out.push(`<${tag}${start}>${items.map((it) => `<li>${inlineMd(escapeHtml(it)).replace(/\n/g, "<br>")}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushPara();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inlineMd(escapeHtml(c.trim())));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("");
}

// ------------------------------------------------------------ message rendering


export { renderMarkdown };
