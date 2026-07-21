"use strict";

import { setCheckpointTreeHandlers, setCommandPaletteHandlers, setComposerHandlers, setHeaderHandlers, setHublotHandlers, setMenuActionHandler, setRoutineHandlers, setSettingsHandlers } from "./lib/legacyBridge.js";
import { setCarouselPage } from "./stores/carousel.js";
import { setCheckpointTreeState } from "./stores/checkpointTree.js";
import { setCommandPaletteState, closeCommandPaletteState } from "./stores/commandPalette.js";
import { updateHeaderState } from "./stores/header.js";
import { hublots, hublotsLoading } from "./stores/hublots.js";
import { openConfirmPrompt, openTextPrompt } from "./stores/dialogs.js";
import { closeModalState, openModal, updateModal } from "./stores/modal.js";
import { openOptionPicker } from "./stores/optionPicker.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "./stores/routines.js";
import { addToast } from "./stores/toasts.js";

// ------------------------------------------------------------ token

let token = null;
{
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const fromUrl = hash.get("token") || query.get("token");
  if (fromUrl) {
    localStorage.setItem("pi_ui_token", fromUrl.trim());
    history.replaceState(null, "", location.pathname);
  }
  token = (localStorage.getItem("pi_ui_token") || "").trim() || null;
  // also carry the token as a cookie: cookies survive proxies that strip
  // Authorization/custom headers, and EventSource can't send headers at all
  if (token) {
    document.cookie = `pi_ui_token=${encodeURIComponent(token)}; path=/; max-age=31536000; samesite=strict`;
  }
}

// Every same-origin API call carries the token as a header instead of in the
// URL (query tokens leak into proxy logs / history; the server now rejects
// them on non-GET requests). Wrapping fetch once beats touching ~40 call
// sites. EventSource and download links still use ?token= — they can't send
// headers — which the server allows for GETs.
{
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, opts = {}) => {
    if (typeof input === "string" && input.startsWith("/") && token) {
      opts = { ...opts, headers: { "x-auth-token": token, ...(opts.headers || {}) } };
    }
    return rawFetch(input, opts);
  };
}

// ------------------------------------------------------------ url routes
// /s/<sessionId>            -> open that session on load
// /s/<sessionId>/m/<entryId> -> …and scroll to / flash that message
// The URL is kept in sync with the active session (history.replaceState),
// so a reload or a shared link always lands on the same session.

const route = (() => {
  const m = location.pathname.match(/^\/s\/([\w.-]+)(?:\/m\/([\w.-]+))?$/);
  return m ? { sessionId: m[1], messageId: m[2] ?? null } : { sessionId: null, messageId: null };
})();

function syncUrlToSession(sessionId) {
  const path = sessionId ? `/s/${encodeURIComponent(sessionId)}` : "/";
  if (location.pathname !== path) history.replaceState(null, "", path);
}

const $ = (id) => document.getElementById(id);
const gate = $("gate");


function requireToken() {
  gate.classList.add("open");
  $("gateInput").focus();
}

// SSE failures: distinguish "server unreachable" from "token rejected".
// Only the server itself saying the token is invalid clears it.
let lastProbeAt = 0;
async function probeTokenValidity() {
  const now = Date.now();
  if (now - lastProbeAt < 10000 || !token) return;
  lastProbeAt = now;
  try {
    const res = await fetch(`/authcheck`);
    if (!res.ok) return; // server not healthy — treat as network issue
    const data = await res.json();
    if (data.authorized === false) {
      localStorage.removeItem("pi_ui_token");
      document.cookie = "pi_ui_token=; path=/; max-age=0";
      updateHeaderState({ stateInfo: "invalid token" });
      requireToken();
    }
  } catch {
    // network error — keep retrying silently
  }
}

// Only drop the stored token if the server itself rejects it on a direct
// probe — a stripped header or transient proxy error must not log the user out.
let verifyingToken = false;
async function handleUnauthorized() {
  if (verifyingToken) return;
  verifyingToken = true;
  try {
    const res = await fetch(`/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "get_state" }),
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_ui_token");
      document.cookie = "pi_ui_token=; path=/; max-age=0";
      requireToken();
    } else {
      toast("temporary auth hiccup — retry", "warning");
    }
  } catch {
    toast("network error — retry", "warning");
  } finally {
    verifyingToken = false;
  }
}
// AuthGate.svelte owns the token-entry form behavior.

// ------------------------------------------------------------ rpc plumbing

const clientId = Math.random().toString(36).slice(2, 8);
let cmdSeq = 0;
const pending = new Map(); // id -> {resolve, reject}

async function rpc(cmd, { wait = true } = {}) {
  const id = `${clientId}-${++cmdSeq}`;
  cmd = { id, ...cmd };
  let waiter = null;
  if (wait) {
    waiter = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${cmd.type}`));
        }
      }, 60000);
    });
  }
  // token goes in the query string + x-auth-token header: some tunnels/proxies
  // strip or overwrite the Authorization header, which showed up as 401s
  const res = await fetch(`/rpc?runner=${encodeURIComponent(currentRunner ?? "")}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-token": token },
    body: JSON.stringify(cmd),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`rpc failed: ${res.status}`);
  // accepted but held behind an in-flight session resume: surface it so a
  // few seconds of silence doesn't read as an unresponsive session (only
  // for prompts — background state fetches queue there routinely)
  const ack = await res.json().catch(() => null);
  if (ack?.pendingResume && cmd.type === "prompt") toast("session is still resuming — message queued", "warning");
  return wait ? waiter : null;
}

function handleResponse(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.success) p.resolve(msg.data);
  else p.reject(new Error(msg.error || "command failed"));
}

// ------------------------------------------------------------ markdown (small, escape-first)

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

function inlineMd(s) {
  // s is already HTML-escaped
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
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
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inlineMd(escapeHtml(it)).replace(/\n/g, "<br>")}</li>`).join("")}</${tag}>`);
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

const messagesEl = $("messages");
// late-loading content (images in markdown) grows the transcript after our
// scroll corrections ran; if the user is at the bottom, stay pinned there
messagesEl.addEventListener("load", () => scrollToBottom(false), true);
const scroller = $("scroller");

function nearBottom() {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
}
function scrollToBottom(force) {
  if (force || nearBottom()) scroller.scrollTop = scroller.scrollHeight;
}

const toolCards = new Map(); // toolCallId -> {el, argsEl, resultEl, statusEl}

function summarizeArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  const first = Object.values(args).find((v) => typeof v === "string");
  return first || "";
}

function createToolCard(tc) {
  const details = document.createElement("details");
  details.className = "block tool";
  const argSummary = summarizeArgs(tc.name, tc.arguments);
  details.innerHTML =
    `<summary><span class="tname">${escapeHtml(tc.name)}</span>` +
    `<span class="targ">${escapeHtml(argSummary)}</span>` +
    `<span class="status running">⏳</span></summary>` +
    `<div class="body"><pre class="args-pre"></pre><pre class="result-pre"></pre></div>`;
  const card = {
    el: details,
    argsEl: details.querySelector(".args-pre"),
    resultEl: details.querySelector(".result-pre"),
    statusEl: details.querySelector(".status"),
    summaryArgEl: details.querySelector(".targ"),
  };
  renderToolArgs(card, tc);
  toolCards.set(tc.id, card);
  return details;
}

function updateToolCard(tc) {
  const card = toolCards.get(tc.id);
  if (!card) return;
  card.summaryArgEl.textContent = summarizeArgs(tc.name, tc.arguments);
  renderToolArgs(card, tc);
}

function renderToolArgs(card, tc) {
  const args = tc.arguments;
  const name = (tc.name || "").toLowerCase();
  if (name === "edit" && args && Array.isArray(args.edits)) {
    card.argsEl.textContent = "";
    let diff = card.el.querySelector(".diff");
    if (!diff) {
      diff = document.createElement("div");
      diff.className = "diff";
      card.argsEl.after(diff);
    }
    let html = "";
    args.edits.forEach((e, i) => {
      if (args.edits.length > 1) html += `<div class="diff-line diff-hdr">edit ${i + 1}:</div>`;
      for (const line of String(e.oldText ?? "").split("\n"))
        html += `<div class="diff-line diff-del">- ${escapeHtml(line)}</div>`;
      for (const line of String(e.newText ?? "").split("\n"))
        html += `<div class="diff-line diff-add">+ ${escapeHtml(line)}</div>`;
    });
    diff.innerHTML = html;
    return;
  }
  card.argsEl.textContent = JSON.stringify(args, null, 2) ?? "";
}

function toolResultText(msg) {
  if (!msg) return "";
  const parts = [];
  const content = msg.content;
  if (typeof content === "string") parts.push(content);
  else if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "image") parts.push(`[image ${c.mimeType}]`);
    }
  }
  return parts.join("\n");
}

function finishToolCard(toolCallId, resultMsgOrText, isError) {
  const card = toolCards.get(toolCallId);
  if (!card) return;
  card.statusEl.textContent = isError ? "✗" : "✓";
  card.statusEl.className = `status ${isError ? "err" : "ok"}`;
  const text = typeof resultMsgOrText === "string" ? resultMsgOrText : toolResultText(resultMsgOrText);
  card.resultEl.textContent = text.length > 20000 ? text.slice(0, 20000) + "\n… (truncated)" : text;
}

let liveAssistant = null; // { root, msg }

function renderBlockEl(block) {
  if (block.type === "thinking") {
    const showThinking = localStorage.getItem("pi_show_thinking") !== "0";
    if (!showThinking || !block.thinking?.trim()) return null;   // hidden, or empty/whitespace
    const d = document.createElement("details");
    d.className = "block thinking";
    d.innerHTML = `<summary>thinking</summary><div class="body"></div>`;
    d.querySelector(".body").textContent = block.thinking;
    return d;
  }
  if (block.type === "text") {
    const div = document.createElement("div");
    div.className = "md";
    div.innerHTML = renderMarkdown(block.text || "");
    return div;
  }
  return null;
}

/**
 * Incremental render: reuse the existing element for every block whose content
 * hasn't changed since the last update. During streaming only the growing
 * block is re-rendered, which avoids flicker, keeps scroll positions inside
 * code/tool output, and preserves the open state of thinking blocks.
 */
function renderAssistantInto(root, message) {
  const blocks = message.content || [];
  const prevKeys = root._blockKeys || [];
  const prevEls = Array.from(root.children);
  const els = [], keys = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const key = block.type + ":" + JSON.stringify(block);
    if (prevKeys[i] === key && prevEls[i]) { els.push(prevEls[i]); keys.push(key); continue; }
    let el;
    if (block.type === "toolCall") {
      const existing = toolCards.get(block.id);
      if (existing) { updateToolCard(block); el = existing.el; }
      else el = createToolCard(block);
    } else {
      el = renderBlockEl(block);
      // a re-rendered details at the same position keeps its open state
      if (el?.tagName === "DETAILS" && prevEls[i]?.tagName === "DETAILS" && prevEls[i].open) el.open = true;
    }
    if (!el) continue;
    els.push(el);
    keys.push(key);
  }
  if (message.stopReason === "error" && message.errorMessage) {
    const div = document.createElement("div");
    div.className = "msg error-msg";
    div.textContent = message.errorMessage;
    els.push(div);
    keys.push("err:" + message.errorMessage);
  }
  root._blockKeys = keys;
  root.replaceChildren(...els);
}

function userText(message) {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  }
  return "";
}

function addUserMessage(message) {
  const text = userText(message);
  // hublot briefings are rendered collapsed, like a tool call
  const iface = text.match(/^Opening interface: (.*)\n/);
  if (iface) {
    const details = document.createElement("details");
    details.className = "block tool";
    details.dataset.role = "user"; // still a user message for permalink alignment
    details.innerHTML =
      `<summary><span class="tname">opening interface</span>` +
      `<span class="targ"></span></summary>` +
      `<div class="body"><pre></pre></div>`;
    details.querySelector(".targ").textContent = iface[1];
    details.querySelector("pre").textContent = text.slice(iface[0].length);
    messagesEl.appendChild(details);
    scrollToBottom(true);
    return;
  }
  const div = document.createElement("div");
  div.className = "msg user";
  div.dataset.role = "user";
  div.textContent = text;
  addPermalinkBtn(div);
  messagesEl.appendChild(div);
  placeCheckpointBtn();
  if (!backfilling) {
    scrollToBottom(true);
    rememberPrompt(text); // bulk renders prefill history in chronological order
  }
}

// Prompts sent in this session (replayed + live), for ↑/↓ recall in the composer.
const promptHistory = [];
let histIdx = null;   // null = not navigating; otherwise index into promptHistory
let histDraft = "";   // what was typed before navigation started

function rememberPrompt(text) {
  if (!text) return;
  if (promptHistory[promptHistory.length - 1] === text) return; // skip consecutive dupes
  promptHistory.push(text);
  histIdx = null;
}

// Texts we already rendered locally on send; pi echoes each prompt back as a
// user message_start, which must not be rendered a second time.
const localEchoes = [];

/** Outer .msg wrapper (carries role + permalink button) with an inner body
 *  used as the render root, so renderAssistantInto can replaceChildren()
 *  without wiping the button. */
function addAssistantContainer() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.dataset.role = "assistant";
  const body = document.createElement("div");
  wrap.appendChild(body);
  addPermalinkBtn(wrap);
  messagesEl.appendChild(wrap);
  placeCheckpointBtn();
  return body;
}

// ------------------------------------------------------------ checkpoints
//
// The iceberg on the LATEST message commits every pending change in the
// runner's workdir (server-side `git add -A && git commit`), freezing the
// state the conversation reached at that point.

const checkpointBtn = document.createElement("span");
checkpointBtn.className = "checkpoint";
checkpointBtn.textContent = "\u{1F9CA}";
checkpointBtn.title = "checkpoint — commit all workdir changes";
/** Modal with a single model selector for the diff-summary sub-agent; the
 *  choice is remembered (localStorage) and preselected next time.
 *  Resolves { model } (null model = no summary) or { cancelled: true }. */
function pickCheckpointModel({
  title = "Freeze checkpoint",
  hint = "The model summarizes the diff into the commit message. Your choice is remembered.",
  okLabel = "Freeze \u{1F9CA}",
} = {}) {
  return new Promise((resolve) => {
    updateModal({ title });
    const body = $("mBody");
    body.innerHTML = "";
    const row = document.createElement("div");
    row.className = "search-row";
    const sel = document.createElement("select");
    sel.style.flex = "1";
    sel.style.maxWidth = "100%";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "\u{1F4A8} No summary — timestamp message";
    sel.appendChild(none);
    const stored = localStorage.getItem("pi_ckpt_model") ?? "";
    // fill the selector asynchronously; the stored choice works immediately
    if (stored) {
      const o = document.createElement("option");
      o.value = stored;
      o.textContent = stored;
      sel.appendChild(o);
      sel.value = stored;
    }
    rpc({ type: "get_available_models" }).then(({ models }) => {
      for (const m of models) {
        const id = `${m.provider}/${m.id}`;
        if (id === stored) continue; // already there
        const o = document.createElement("option");
        o.value = id;
        o.textContent = id;
        sel.appendChild(o);
      }
    }).catch(() => {});
    row.appendChild(sel);
    const hintEl = document.createElement("div");
    hintEl.className = "m-path";
    hintEl.textContent = hint;
    body.append(row, hintEl);
    const actions = $("mActions");
    const cancel = document.createElement("span");
    cancel.className = "chip";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { closeModal(); resolve({ cancelled: true }); });
    const ok = document.createElement("button");
    ok.className = "btn";
    ok.textContent = okLabel;
    ok.style.padding = "6px 16px";
    ok.addEventListener("click", () => {
      const model = sel.value || null;
      localStorage.setItem("pi_ckpt_model", sel.value);
      closeModal();
      resolve({ model });
    });
    actions.append(cancel, ok);
    openModal({ title });
  });
}

checkpointBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (checkpointBtn.classList.contains("busy")) return;
  const pick = await pickCheckpointModel();
  if (pick.cancelled) return; // no checkpoint
  const model = pick.model;
  checkpointBtn.classList.add("busy");
  if (model) toast(`\u{1F9CA} summarizing diff with ${model}…`);
  try {
    const res = await fetch(
      `/checkpoint?runner=${encodeURIComponent(currentRunner ?? "")}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
    if (data.committed) {
      const what = data.summarized
        ? `“${data.message.replace(/^checkpoint: /, "")}”`
        : `${data.files} file${data.files === 1 ? "" : "s"} committed`;
      toast(`\u{1F9CA} checkpoint ${data.hash} — ${what}`);
    } else if (data.recorded) {
      toast(`\u{1F9CA} workdir clean — checkpoint marked at ${data.hash}`);
    } else {
      toast(`\u{1F9CA} nothing to commit — ${data.reason ?? "workdir is clean"}`);
    }
    if (data.recorded) {
      refreshCheckpointMarkers().catch(() => {});
      refreshTreeIfOpen();
    }
  } catch (err) {
    toast(`checkpoint failed: ${err.message}`, "error");
  } finally {
    checkpointBtn.classList.remove("busy");
  }
});

/** keep the iceberg attached to the latest user/assistant message */
function placeCheckpointBtn() {
  const els = chatEls();
  const last = els[els.length - 1];
  if (last) last.appendChild(checkpointBtn);
  else checkpointBtn.remove();
}

/** put a return arrow on every message a checkpoint is anchored to */
async function refreshCheckpointMarkers() {
  document.querySelectorAll(".ckpt-restore").forEach((b) => b.remove());
  document.querySelectorAll(".ckpt-frozen").forEach((el) => el.classList.remove("ckpt-frozen"));
  const sid = state?.sessionId;
  if (!sid) return;
  const res = await fetch(`/checkpoints?id=${encodeURIComponent(sid)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return;
  const checkpoints = data.checkpoints ?? [];
  if (!checkpoints.length) return;
  const byAnchor = new Map(checkpoints.map((c) => [c.anchorId, c])); // latest per anchor wins
  let entries;
  try { entries = await fetchSessionEntries(); } catch { return; }
  const els = chatEls();
  for (let i = 0; i < entries.length; i++) {
    const cp = { ...byAnchor.get(entries[i].id), sessionId: sid };
    if (!cp.hash) continue;
    // same zip-by-position logic as the permalinks (align from the end when
    // the file and the rendered transcript briefly disagree)
    const pos = entries.length === els.length ? i : els.length - (entries.length - i);
    const el = els[pos];
    if (!el || el.querySelector(":scope > .ckpt-restore")) continue;
    el.classList.add("ckpt-frozen"); // icy accent marks it as rollbackable
    const b = document.createElement("span");
    b.className = "ckpt-restore";
    b.textContent = "\u21A9";
    b.title = `roll the workdir back to checkpoint ${cp.hash} and fork the session here`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      rollbackToCheckpoint(cp, b);
    });
    el.appendChild(b);
  }
}

/** deterministic rollback: restore the checkpoint commit (pending changes are
 *  auto-committed first) and jump into a session forked at that point */
async function rollbackToCheckpoint(cp, btn) {
  if (btn?.classList.contains("busy")) return;
  // same modal as freeze: the model summarizes the pending changes that get
  // auto-committed before the reset (the modal doubles as confirmation)
  const pick = await pickCheckpointModel({
    title: `Roll back to ${cp.hash}`,
    hint: "Pending changes are committed first (nothing is lost) — the model summarizes them into that commit's message — then the workdir is reset and a forked session opens at this message.",
    okLabel: "Roll back \u23EA",
  });
  if (pick.cancelled) return;
  btn?.classList.add("busy");
  try {
    const res = await fetch(`/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: cp.sessionId ?? state?.sessionId, hash: cp.hash, model: pick.model }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
    toast(`\u23EA rolled back to ${data.rolledBack}${data.safety ? ` (pending work saved as ${data.safety})` : ""} — forked session opened`);
    if (data.runner?.id) switchToRunner(data.runner.id);
  } catch (err) {
    toast(`rollback failed: ${err.message}`, "error");
  } finally {
    btn?.classList.remove("busy");
  }
}

// ------------------------------------------------------------ checkpoint / fork tree sidebar
//
// The ⎇ chip toggles a right sidebar showing the current session's whole
// family: its root ancestor, every fork (nested under the checkpoint it was
// created from), and each session's checkpoints. Sessions switch on tap;
// checkpoints roll back on tap.

function refreshTreeIfOpen() {
  setCheckpointTreeState({ currentSessionId: state?.sessionId ?? null, runners: runnersNow });
  if ($("treebar").classList.contains("open")) loadCheckpointTree();
}

async function loadCheckpointTree() {
  const path = state?.sessionFile
    ?? runnersNow.find((r) => r.id === currentRunner)?.sessionFile;
  setCheckpointTreeState({
    loading: !!path,
    error: "",
    empty: path ? "" : "no session file yet — send a message first",
    currentSessionId: state?.sessionId ?? null,
    runners: runnersNow,
  });
  if (!path) return;
  // the session file is only written to disk once the first message has
  // been sent — until then the server 400s. Treat that as "no tree yet".
  try {
    const res = await fetch(`/checkpoint-tree?path=${encodeURIComponent(path)}`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && /not a session file|no such file/i.test(data.error || "")) {
      setCheckpointTreeState({ loading: false, root: null, empty: "no session file yet — send a message first" });
      return;
    }
    if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
    setCheckpointTreeState({ loading: false, root: data.root, empty: "", error: "" });
  } catch (e) {
    setCheckpointTreeState({ loading: false, root: null, empty: "", error: `tree unavailable: ${e.message}` });
  }
}

async function openTreeSession(node) {
  if (node.id === state?.sessionId) return;
  try {
    const r = await openSessionRunner({ sessionPath: node.path, dir: node.cwd || workdir });
    switchToRunner(r.id);
    toast(`switched to: ${node.name || node.id.slice(0, 8)}`);
  } catch (e) {
    toast(`switch failed: ${e.message}`, "error");
  }
}

setCheckpointTreeHandlers({ openSession: openTreeSession, rollback: rollbackToCheckpoint });

function renderFullMessage(message) {
  const role = message.role;
  if (role === "user") { addUserMessage(message); return; }
  if (role === "assistant") {
    const root = addAssistantContainer();
    renderAssistantInto(root, message);
    return;
  }
  if (role === "toolResult") {
    if (toolCards.has(message.toolCallId)) {
      finishToolCard(message.toolCallId, message, message.isError);
    }
    return;
  }
  // custom messages (extensions etc.) — show generically if they carry text
  if (message.content) {
    const text = toolResultText(message);
    if (text) {
      const root = addAssistantContainer();
      // not a real assistant message: exclude it from permalink alignment
      root.parentElement.dataset.role = message.role || "custom";
      root.innerHTML = `<div class="md">${renderMarkdown(text)}</div>`;
    }
  }
}

function clearMessages() {
  renderJob++; // cancel any in-flight transcript backfill
  checkpointBtn.remove();
  messagesEl.innerHTML = "";
  toolCards.clear();
  liveAssistant = null;
  promptHistory.length = 0;
  histIdx = null;
  histDraft = "";
}

// ---- transcript rendering: tail first, history backfilled above -----------
// The viewport is pinned to the BOTTOM, so only the newest turns need to be
// on screen immediately. renderTranscript() renders those synchronously and
// then backfills older turns in chunks: each chunk is rendered through the
// normal (appending) helpers and moved above the existing content within the
// same task — before the browser paints — with a scrollTop correction, so
// the visible area never moves. Chunks split at user messages only, keeping
// toolCall/toolResult pairs (which finish each other's cards) together.

let renderJob = 0;      // bumped to cancel in-flight backfills
let backfilling = false; // suppresses per-message scroll/history side effects

const TAIL_MSGS = 40;    // rendered synchronously (visible screenful + slack)
const CHUNK_MSGS = 60;   // per backfill timeslice

function splitTurns(messages) {
  const turns = [];
  let cur = [];
  for (const m of messages) {
    if (m.role === "user" && cur.length) { turns.push(cur); cur = []; }
    cur.push(m);
  }
  if (cur.length) turns.push(cur);
  return turns;
}

/** pop whole turns off the end of `turns` until ~max messages (≥ 1 turn) */
function takeTailChunk(turns, max) {
  const chunk = [];
  while (turns.length && (chunk.length === 0 || chunk.length + turns[turns.length - 1].length <= max)) {
    chunk.unshift(...turns.pop());
    if (chunk.length >= max) break;
  }
  return chunk;
}

function renderChunk(chunk) {
  backfilling = true;
  try { for (const m of chunk) renderFullMessage(m); }
  finally { backfilling = false; }
}

/** Render `messages`; resolves true when the FULL transcript is in the DOM
 *  (false if superseded by a newer render). */
function renderTranscript(messages) {
  clearMessages(); // also bumps renderJob, cancelling any older backfill
  const myJob = ++renderJob;
  // ↑/↓ prompt recall must stay chronological even though rendering is
  // tail-first: prefill it from the full list (same skip rule as addUserMessage)
  for (const m of messages) {
    if (m.role !== "user") continue;
    const t = userText(m);
    if (t && !/^Opening interface: /.test(t)) rememberPrompt(t);
  }
  const turns = splitTurns(messages);
  const tail = takeTailChunk(turns, TAIL_MSGS);
  renderChunk(tail);
  scrollToBottom(true);
  return new Promise((resolve) => {
    const backfill = () => {
      if (myJob !== renderJob) { resolve(false); return; }
      if (!turns.length) { resolve(true); return; }
      const chunk = takeTailChunk(turns, CHUNK_MSGS);
      const anchor = messagesEl.firstChild;
      const before = messagesEl.children.length;
      // measure BEFORE rendering: the chunk is appended at the bottom first,
      // so the height it adds must be attributed to the top once moved there
      const pinned = nearBottom();
      const h0 = scroller.scrollHeight;
      const t0 = scroller.scrollTop;
      renderChunk(chunk); // appended at the bottom by the shared helpers…
      // …then moved above everything in the same task (no paint in between)
      const added = [...messagesEl.children].slice(before);
      for (const el of added) messagesEl.insertBefore(el, anchor);
      if (pinned) scrollToBottom(true); // stay glued to the newest message
      else scroller.scrollTop = t0 + (scroller.scrollHeight - h0); // keep reading position
      placeCheckpointBtn(); // back onto the true last message
      setTimeout(backfill, 0); // yield so live events/input stay responsive
    };
    setTimeout(backfill, 0);
  });
}

// ------------------------------------------------------------ state / header

let state = null;

function fmtCost(n) { return n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0"; }

function applyState(s) {
  const sessionChanged = s?.sessionId !== state?.sessionId;
  state = s;
  if (sessionChanged) {
    routines.set(routinesNow.filter(routineVisible));
    routineScopeAll.set(tunnelScopeAll);
    routineCurrentSessionId.set(s?.sessionId ?? null);
    loadHublots(); loadRoutines();
  } // sidebar tunnels are session-scoped; routines follow the workdir
  if (sessionChanged) syncUrlToSession(s?.sessionId); // keep /s/<sessionId> in the address bar
  updateHeaderState({
    sessionTitle: s.sessionName || "pi-lot",
    modelChip: s.model ? s.model.id : "no model",
    thinkChip: `think: ${s.thinkingLevel}`,
    cfgChip: `${s.model ? s.model.id : "no model"} · ${s.thinkingLevel}`,
    stateInfo: `${s.model ? s.model.provider : "?"} · ${s.messageCount} msgs` +
      (s.pendingMessageCount ? ` · ${s.pendingMessageCount} queued` : ""),
  });
  setBusy(s.isStreaming || s.isCompacting);
}

let workdir = null;

// ------------------------------------------------------------ runners
// The server keeps one pi process ("runner") per open session; this client
// is attached to exactly one at a time. Other runners keep working in the
// background.

let currentRunner = localStorage.getItem("pi_runner") || null;
let runnersNow = []; // latest known runner list (for session indicators)
/** one-shot callback run after the next transcript reload (e.g. focus a search hit) */
let afterTranscript = null;

function setRunner(id) {
  currentRunner = id || null;
  if (id) localStorage.setItem("pi_runner", id);
  else localStorage.removeItem("pi_runner");
}

/** attach this client to another runner and rebuild the UI from its stream */
function switchToRunner(id) {
  if (id === currentRunner) { lastPreview = null; refreshState(); return; }
  setRunner(id);
  clearMessages();
  // the new session has its own tree — reset the carousel/sidebar so a
  // lingering open sidebar from the previous session doesn't show stale data
  if (carousel !== 0) { carousel = 0; localStorage.setItem("pi_carousel", "0"); }
  $("hublots").classList.remove("open");
  $("treebar").classList.remove("open");
  setCarouselDots();
  renderPreviewNow(); // instant transcript from the session file, if fetched
  knownCommands = null; // commands can differ per project
  connect(); // reopen SSE on the new runner; onopen reloads the transcript
}

// ---- instant transcript preview -------------------------------------------
// Opening a session waits on a pi process spawning AND resuming the session
// before get_messages can answer (the server holds commands back during the
// resume). The transcript itself lives in the session .jsonl though, which
// the server parses from an mtime cache — so fetch it in parallel and render
// it immediately; the canonical get_messages render replaces it when pi is
// ready. `lastPreview` is cleared the moment canonical content lands, so a
// slow preview response can never overwrite fresh state.

let lastPreview = null; // { sessionPath, messages|null }

function renderPreviewNow() {
  if (!lastPreview?.messages?.length) return;
  // no checkpoint markers here: `state` still describes the previous session
  // until get_state answers; the canonical reload adds them right after
  renderTranscript(lastPreview.messages);
}

async function fetchPreview(sessionPath) {
  try {
    const res = await fetch(`/session-messages?path=${encodeURIComponent(sessionPath)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (lastPreview?.sessionPath !== sessionPath) return; // superseded meanwhile
    lastPreview.messages = data.messages;
    renderPreviewNow();
  } catch {}
}

/** get-or-spawn a runner for a session file / folder */
async function openSessionRunner({ sessionPath = null, dir = null } = {}) {
  // kick off the file-based transcript preview in parallel — unless the
  // target session is the one already on screen (don't clobber live state)
  const cur = runnersNow.find((r) => r.id === currentRunner);
  if (sessionPath && sessionPath !== cur?.sessionFile) {
    lastPreview = { sessionPath, messages: null };
    fetchPreview(sessionPath);
  }
  const res = await fetch(`/open-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath, dir }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `open-session failed (${res.status})`);
  return data.runner;
}

/** hook: session picker (when open) re-renders its indicators */
let onRunnersUpdate = null;

function setWorkdir(dir) {
  workdir = dir;
  updateHeaderState({
    workdirText: dir ? `📁 ${dir.length > 40 ? "…" + dir.slice(-39) : dir}` : "",
    workdirTitle: dir || "",
  });
}

let busy = false;
function setBusy(b) {
  busy = b;
  const hasText = !!$("input").value.trim();
  updateHeaderState({
    connectionClass: connected ? `dot ${b ? "busy" : "ok"}` : "dot",
    sendText: b ? "Steer" : "Send",
    sendHidden: b && !hasText,
    stopHidden: !b,
  });
}

function updateUsage(message) {
  const u = message?.usage;
  if (!u) return;
  updateHeaderState({
    usageInfo: `↑${u.input.toLocaleString()} ↓${u.output.toLocaleString()} tok · ${fmtCost(u.cost?.total ?? 0)}`,
  });
}

// ------------------------------------------------------------ event stream

let connected = false;
let es = null;

// Watchdog: the server sends a ping event every 25s. Through a tunnel, a
// connection can die without the browser noticing (EventSource stays OPEN
// forever on a half-dead socket) — if nothing arrives for 70s, force a
// reconnect.
let lastEventAt = Date.now();
setInterval(() => {
  if (es && Date.now() - lastEventAt > 70000) {
    es.close();
    connected = false;
    updateHeaderState({ connectionClass: "dot", stateInfo: "connection lost — reconnecting…" });
    connect();
  }
}, 15000);

function connect() {
  if (!token) { requireToken(); return; }
  if (es) { try { es.close(); } catch {} }
  lastEventAt = Date.now();
  replaying = true;
  es = new EventSource(`/events?token=${encodeURIComponent(token)}&runner=${encodeURIComponent(currentRunner ?? "")}`);
  es.onopen = async () => {
    connected = true;
    updateHeaderState({ connectionClass: "dot ok", stateInfo: "connected" });
    try {
      // Always rebuild from the canonical transcript: the SSE replay buffer
      // re-delivers recent events on reconnect, so rendering them onto the
      // existing DOM would duplicate messages.
      await reloadTranscript();
    } catch (e) {
      // a failed reload must not wedge the stream in replay mode forever
      replaying = false;
      if (String(e.message).includes("unauthorized")) return;
      toast(`init failed: ${e.message}`, "error");
    }
  };
  es.onerror = () => {
    connected = false;
    updateHeaderState({ connectionClass: "dot", stateInfo: "reconnecting…" });
    // EventSource can't see HTTP status codes, so a 401 (bad stored token)
    // looks identical to a network blip and would retry forever. Probe
    // /authcheck to tell them apart, at most once per 10s.
    probeTokenValidity();
  };
  es.onmessage = (ev) => {
    lastEventAt = Date.now();
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    try { handleEvent(msg); } catch (e) {
      console.error("event handling failed", e, msg);
    }
  };
}

// True from (re)connect until the canonical transcript's tail is rendered.
// This covers BOTH the SSE replay buffer and the live events of a busy
// runner: rendering either before reloadTranscript() has rebuilt the
// transcript would paint duplicates onto the preview and fight its scroll
// position. reloadTranscript() lifts the gate the moment the tail is in the
// DOM (live events append below it just fine while history backfills above).
let replaying = true;

function handleEvent(msg) {
  // While the SSE replay buffer is being re-delivered, drop transcript-
  // rendering events: reloadTranscript() rebuilds the canonical state, so
  // rendering replayed copies would duplicate messages/tool cards.
  if (replaying && ["message_start", "message_update", "message_end",
       "tool_execution_start", "tool_execution_update", "tool_execution_end",
       "agent_start", "agent_end"].includes(msg.type)) {
    return;
  }
  switch (msg.type) {
    case "ping":
      // pings carry the authoritative runner list: reconcile liveness the
      // client may have missed (pi_exit scrolled out of the replay buffer)
      if (msg.runners && JSON.stringify(msg.runners) !== JSON.stringify(runnersNow)) {
        runnersNow = msg.runners;
        onRunnersUpdate?.(runnersNow);
        refreshTreeIfOpen();
      }
      return;

    case "replay_done":
      // NOTE: `replaying` stays true here — only the canonical transcript
      // render (reloadTranscript) opens the live-event gate
      if (msg.runner) setRunner(msg.runner); // server may have fallen back to another runner
      if (msg.runners) runnersNow = msg.runners;
      if (msg.workdir) setWorkdir(msg.workdir);
      loadHublots();
      loadRoutines();
      return;

    case "runners_update":
      runnersNow = msg.runners ?? [];
      onRunnersUpdate?.(runnersNow);
      refreshTreeIfOpen(); // keep the live/busy dots in the tree current
      return;

    case "response":
      handleResponse(msg);
      // state changes often follow commands; refresh cheaply
      if (["set_model", "set_thinking_level", "cycle_thinking_level", "new_session",
           "switch_session", "compact", "set_session_name"].includes(msg.command)) {
        refreshState();
      }
      return;

    case "agent_start":
      setBusy(true);
      return;

    case "agent_end":
      setBusy(false);
      liveAssistant = null;
      refreshState();
      return;

    case "message_start": {
      const m = msg.message;
      if (m.role === "assistant") {
        liveAssistant = { root: addAssistantContainer(), msg: m };
        renderAssistantInto(liveAssistant.root, m);
        scrollToBottom(true);
      } else if (m.role === "user") {
        const idx = localEchoes.indexOf(userText(m));
        if (idx !== -1) localEchoes.splice(idx, 1); // already rendered on send
        else addUserMessage(m);
      }
      return;
    }

    case "message_update": {
      const m = msg.message;
      if (m.role === "assistant") {
        if (!liveAssistant) liveAssistant = { root: addAssistantContainer(), msg: m };
        renderAssistantInto(liveAssistant.root, m);
        scrollToBottom(false);
      }
      return;
    }

    case "message_end": {
      const m = msg.message;
      if (m.role === "assistant") {
        if (liveAssistant) { renderAssistantInto(liveAssistant.root, m); liveAssistant = null; }
        else { const root = addAssistantContainer(); renderAssistantInto(root, m); }
        updateUsage(m);
      } else if (m.role === "toolResult") {
        finishToolCard(m.toolCallId, m, m.isError);
      }
      scrollToBottom(false);
      return;
    }

    case "tool_execution_start": {
      const card = toolCards.get(msg.toolCallId);
      if (card) { card.statusEl.textContent = "⏳"; card.statusEl.className = "status running"; }
      return;
    }

    case "tool_execution_update": {
      const card = toolCards.get(msg.toolCallId);
      if (card && msg.partialResult) {
        const text = typeof msg.partialResult === "string"
          ? msg.partialResult
          : toolResultText(msg.partialResult) || JSON.stringify(msg.partialResult);
        card.resultEl.textContent = text.slice(-20000);
      }
      return;
    }

    case "tool_execution_end":
      finishToolCard(
        msg.toolCallId,
        typeof msg.result === "string" ? msg.result : toolResultText(msg.result) || JSON.stringify(msg.result, null, 2),
        msg.isError
      );
      scrollToBottom(false);
      return;

    case "extension_ui_request":
      handleExtensionUI(msg);
      return;

    case "pi_exit":
      // replayed copies describe past restarts, not the current process
      if (replaying) return;
      toast("pi process exited — it will restart on next message", "warning");
      setBusy(false);
      return;

    case "pi_started":
      if (replaying) return;
      if (msg.startCount > 1) {
        toast("pi process restarted");
        // the runner auto-resumes its session on respawn; rebuild the
        // transcript from canonical state (get_state/get_messages queue
        // behind the in-flight resume server-side, so this settles right
        // after the session is back)
        reloadTranscript().catch((e) => toast(`session reload failed: ${e.message}`, "error"));
      }
      return;

    case "pi_error":
      if (replaying) return;
      toast(`pi spawn error: ${msg.error}`, "error");
      return;

    case "runner_unhealthy":
      // server-side watchdog: pi stopped answering health probes
      if (replaying) return;
      toast(`pi was unresponsive — restarting it (${msg.reason ?? "health probes failed"})`, "warning");
      setBusy(false);
      return;

    case "ui_reload":
      // the page on disk changed; offer a refresh. Ignore replayed copies of
      // this event — after a refresh we already run the newest version.
      if (replaying) return;
      toast("UI updated — tap to refresh", "warning", { onClick: () => location.reload(), sticky: true });
      return;

    case "code_reloaded":
      if (!replaying) toast("server code hot-reloaded");
      return;

    case "code_reload_failed":
      if (!replaying) toast(`server reload failed: ${msg.error}`, "error");
      return;

    case "tunnel_opened":
      if (!replaying) {
        toast(`hublot up: ${msg.tunnel?.url} → :${msg.tunnel?.port}`, "info", {
          onClick: () => window.open(msg.tunnel?.url, "_blank"),
        });
        loadHublots();
      }
      return;

    case "hublot_ready":
      if (!replaying) {
        toast(`hublot ready: ${msg.tunnel?.url}`, "info", {
          onClick: () => window.open(msg.tunnel?.url, "_blank"),
        });
        // rebuild previews now, then again shortly after: recreating the
        // iframe is the only way to reload a possibly-captured error page,
        // and the edge can lag a moment behind the ready signal
        loadHublots();
        setTimeout(loadHublots, 5000);
        setTimeout(loadHublots, 15000);
      }
      return;

    case "hublot_failed":
      if (!replaying) toast(`hublot failed: ${msg.error ?? "unknown error"}`, "error");
      return;

    case "tunnel_closed":
      if (!replaying) {
        toast(`hublot closed: :${msg.tunnel?.port}`, "warning");
        loadHublots();
      }
      return;

    case "routine_update": {
      if (replaying) return;
      const r = msg.routine;
      if (!r) return;
      const i = routinesNow.findIndex((x) => x.path === r.path);
      if (msg.reason === "deleted") {
        if (i !== -1) routinesNow.splice(i, 1);
      } else if (i === -1) routinesNow.push(r);
      else routinesNow[i] = r;
      syncRoutinesStore();
      if (msg.reason === "created") { toast(`routine “${r.name}” created`); return; }
      if (msg.reason === "updated") { toast(`routine “${r.name}” updated`); return; }
      if (msg.reason === "deleted") { toast(`routine “${r.name}” deleted`, "warning"); return; }
      // progression notifications surface as toasts only for terminal states;
      // live progress is shown on the block's bar/message
      if (msg.reason === "finished") {
        toast(
          r.exitCode === 0 ? `routine “${r.name}” finished` : `routine “${r.name}” failed (exit ${r.exitCode})`,
          r.exitCode === 0 ? "info" : "error"
        );
      } else if (msg.reason === "stopped") {
        toast(`routine “${r.name}” stopped`, "warning");
      } else if (msg.reason === "teardown_finished") {
        toast(
          r.status === "idle" ? `routine “${r.name}” torn down — byproducts removed` : `routine “${r.name}” teardown failed`,
          r.status === "idle" ? "info" : "error"
        );
      } else if (msg.reason === "error") {
        toast(`routine “${r.name}”: ${r.message ?? "spawn failed"}`, "error");
      } else if (msg.reason === "released") {
        toast(`routine “${r.name}” released`);
      }
      return;
    }
  }
}

async function reloadTranscript() {
  // one parallel round trip instead of two serial ones (both commands queue
  // behind an in-flight session resume anyway, so order doesn't matter)
  const [s, { messages }] = await Promise.all([
    rpc({ type: "get_state" }),
    rpc({ type: "get_messages" }),
  ]);
  applyState(s);
  lastPreview = null; // canonical content from pi supersedes the file preview
  const rendered = renderTranscript(messages); // tail is in the DOM after this call
  // the transcript now shows the right last messages: let live events through
  // (they append below the tail; backfill continues above the viewport)
  replaying = false;
  const complete = await rendered;
  // markers and the permalink-focus callback need the FULL transcript in the
  // DOM (their targets may live in a backfilled chunk); skip both if this
  // render was superseded by a newer one meanwhile
  if (!complete) return;
  refreshCheckpointMarkers().catch(() => {});
  refreshTreeIfOpen();
  const cb = afterTranscript;
  afterTranscript = null;
  cb?.();
}

let stateRefreshTimer = null;
function refreshState() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(async () => {
    try { applyState(await rpc({ type: "get_state" })); } catch {}
  }, 150);
}

// ------------------------------------------------------------ composer

const input = $("input");

function composerInputChanged() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  setBusy(busy); // refresh busy state UI
  histIdx = null; // typing exits history navigation
}

function setComposerText(text) {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

// ↑/↓ recall previous prompts, shell-style: ↑ only when the caret is on the
// first line, ↓ only on the last line, so arrows still move within multiline
// drafts. Typing resets navigation; ↓ past the newest entry restores the draft.
function navigateHistory(dir) {
  if (!promptHistory.length) return false;
  const caret = input.selectionStart;
  const onFirstLine = !input.value.slice(0, caret).includes("\n");
  const onLastLine = !input.value.slice(input.selectionEnd).includes("\n");
  if (dir === -1) {
    if (!onFirstLine) return false;
    if (histIdx === null) {
      histDraft = input.value;
      histIdx = promptHistory.length - 1;
    } else if (histIdx > 0) {
      histIdx--;
    } else {
      return true; // already at oldest; swallow the key
    }
    setComposerText(promptHistory[histIdx]);
    return true;
  }
  // dir === +1
  if (histIdx === null || !onLastLine) return false;
  if (histIdx < promptHistory.length - 1) {
    histIdx++;
    setComposerText(promptHistory[histIdx]);
  } else {
    histIdx = null;
    setComposerText(histDraft);
  }
  return true;
}

function composerKeydown(e) {
  if (e.isComposing) return;

  // when the palette is open the global capture handler already consumed
  // Enter/Tab/Arrows/Escape — bail so we don't double-handle
  if (cmdPalette.classList.contains("open")) return;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
    return;
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    if (navigateHistory(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
  }
}

// pi's slash commands (extensions, prompt templates, skills), cached until
// the pi process or folder changes
let knownCommands = null;
async function getKnownCommands() {
  if (knownCommands) return knownCommands;
  try {
    const { commands } = await rpc({ type: "get_commands" });
    knownCommands = new Set(commands.map((c) => c.name));
  } catch {
    knownCommands = null; // retry next time
    return new Set();
  }
  return knownCommands;
}

function promptRpcCommand(text) {
  return { type: "prompt", message: text, ...(busy ? { streamingBehavior: "steer" } : {}) };
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  // guard against typos like "/goal": an unknown slash command is not
  // expanded by pi — it goes to the model as plain text, which can kick off
  // a long unwanted agent run
  if (text.startsWith("/")) {
    const name = text.slice(1).split(/\s+/)[0];
    if (name) {
      const cmds = await getKnownCommands();
      if (!cmds.has(name)) {
        const proceed = await confirmDialog(
          "Unknown command",
          `"/${name}" is not a pi command. Send it to the model as plain text?`
        );
        if (!proceed) return; // text stays in the composer
      }
    }
  }
  input.value = "";
  input.style.height = "auto";
  setBusy(busy); // hide the Steer button again
  addUserMessage({ role: "user", content: text });
  localEchoes.push(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
  } catch (e) {
    const idx = localEchoes.indexOf(text);
    if (idx !== -1) localEchoes.splice(idx, 1);
    toast(`send failed: ${e.message}`, "error");
  }
}

async function abort() {
  try { await rpc({ type: "abort" }, { wait: false }); toast("aborted"); }
  catch (e) { toast(`abort failed: ${e.message}`, "error"); }
}

setComposerHandlers({ inputChanged: composerInputChanged, keydown: composerKeydown, send, abort });

// ------------------------------------------------------------ command palette
// Slack-style ":" command picker — works on any textarea/input. Type ":"
// to see available commands, filter by typing more, pick with Enter/Tap.

const cmdPalette = $("cmdPalette");

const commands = [
  {
    name: "file",
    desc: "Open file explorer and insert a path",
    icon: "\u{1F4C2}",
    run: () => {
      const trigger = getCommandTrigger(cmdState.target);
      const placeholder = trigger ? trigger.text : null;
      const target = cmdState.target;
      closeCmdPalette();
      // if the hublot modal was open when we launched, return to it afterwards
      const returnToHublot = overlay.classList.contains("open");
      showFilePicker(
        (path) => { insertAtTextarea(target, placeholder, path); },
        null,
        returnToHublot,
      );
    },
  },
];

let cmdState = null; // { target, match, active, trigger } | null

function getCommandTrigger(el) {
  const val = el.value;
  const caret = el.selectionStart;
  const before = val.slice(0, caret);
  const m = before.match(/(^|\s):([a-zA-Z0-9_]*)$/);
  if (!m) return null;
  return { text: ":" + m[2], start: caret - m[2].length };
}

function getFilteredCommands(match) {
  const q = (match || "").toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.name.startsWith(q));
}

function positionCmdPalette(el) {
  const rect = el.getBoundingClientRect();
  const gap = 8;
  const pw = Math.min(420, Math.max(280, rect.width));
  const maxH = 320;
  let left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  let top;
  const patch = { left: left + "px", width: pw + "px" };
  if (rect.top > maxH + gap) {
    top = rect.top - gap; // place above
    patch.bottom = window.innerHeight - top + "px";
    patch.top = "auto";
  } else {
    top = rect.bottom + gap; // place below
    patch.top = top + "px";
    patch.bottom = "auto";
  }
  patch.maxHeight = Math.min(maxH, window.innerHeight - (rect.top > maxH ? top : rect.bottom) - gap * 2) + "px";
  setCommandPaletteState(patch);
}

function openCmdPalette(el, match, trigger) {
  cmdState = { target: el, match: match || "", active: 0, trigger };
  positionCmdPalette(el);
  renderCmdPalette();
}

function closeCmdPalette() {
  cmdState = null;
  closeCommandPaletteState();
}

function moveCmd(dir) {
  if (!cmdState) return;
  const items = getFilteredCommands(cmdState.match);
  if (!items.length) return;
  cmdState.active = (cmdState.active + dir + items.length) % items.length;
  renderCmdPalette();
}

function runActiveCmd() {
  if (!cmdState) return false;
  const items = getFilteredCommands(cmdState.match);
  if (!items.length) { closeCmdPalette(); return false; }
  items[cmdState.active].run();
  return true;
}

function setActiveCmd(index) {
  if (!cmdState || cmdState.active === index) return;
  const items = getFilteredCommands(cmdState.match);
  if (index < 0 || index >= items.length) return;
  cmdState.active = index;
  renderCmdPalette();
}

function runCmdIndex(index) {
  if (!cmdState) return false;
  setActiveCmd(index);
  return runActiveCmd();
}

/** Insert text into a textarea, optionally replacing a placeholder token. */
function insertAtTextarea(el, placeholder, result) {
  const val = el.value;
  let idx = placeholder ? val.lastIndexOf(placeholder) : -1;
  if (idx === -1) { appendAtCaret(el, result); return; }
  const before = val.slice(0, idx);
  const after = val.slice(idx + placeholder.length);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  el.value = before + pad + result + padAfter + after;
  const pos = (before + pad + result).length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input"));
  el.focus();
}

function appendAtCaret(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(el.selectionEnd ?? start);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  el.value = before + pad + text + padAfter + after;
  const pos = (before + pad + text).length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input"));
  el.focus();
}

function renderCmdPalette() {
  if (!cmdState) return;
  const { match, active } = cmdState;
  const items = getFilteredCommands(match);
  if (!items.length) {
    setCommandPaletteState({
      open: true,
      match,
      emptyText: `no command matches ":${match}"`,
      items: [],
    });
    return;
  }
  setCommandPaletteState({
    open: true,
    match,
    emptyText: "",
    items: items.map((cmd, i) => ({
      icon: cmd.icon,
      desc: cmd.desc,
      highlight: cmd.name.slice(0, match.length),
      rest: cmd.name.slice(match.length),
      active: i === active,
    })),
  });
}

/** Wire a textarea/input to the shared command palette. */
function setupCommandPalette(el) {
  el.addEventListener("input", () => {
    const trigger = getCommandTrigger(el);
    if (trigger && trigger.text.length >= 1) {
      const match = trigger.text.slice(1);
      if (!cmdState || cmdState.target !== el || cmdState.trigger?.text !== trigger.text) {
        openCmdPalette(el, match, trigger);
      } else {
        cmdState.match = match;
        cmdState.active = 0;
        positionCmdPalette(el);
        renderCmdPalette();
      }
    } else if (cmdState && cmdState.target === el) {
      closeCmdPalette();
    }
  });
  el.addEventListener("blur", () => setTimeout(() => {
    if (cmdState?.target === el) closeCmdPalette();
  }, 150));
}

setCommandPaletteHandlers({ setActive: setActiveCmd, runIndex: runCmdIndex });

setupCommandPalette(input);

// global keydown: palette navigation while it's open (capture = fires first)
document.addEventListener("keydown", (e) => {
  if (!cmdPalette.classList.contains("open")) return;
  if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveCmd(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveCmd(-1); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); runActiveCmd(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCmdPalette(); }
}, true);

// ------------------------------------------------------------ menu & actions

async function runMenuAction(action) {
  try {
    if (action === "newSession") {
      // a fresh runner, so the current session keeps running in the background
      const r = await openSessionRunner({ dir: workdir });
      switchToRunner(r.id);
      toast("new session");
    } else if (action === "newSessionIn") {
      await showFolderBrowser();
    } else if (action === "sessions") {
      await showSessionPicker();
    } else if (action === "compact") {
      toast("compacting…");
      await rpc({ type: "compact" });
      toast("compacted");
      const { messages } = await rpc({ type: "get_messages" });
      clearMessages();
      for (const m of messages) renderFullMessage(m);
    } else if (action === "restart") {
      await fetch(`/restart?runner=${encodeURIComponent(currentRunner ?? "")}`, { method: "POST" });
      // blank slate while pi respawns; the pi_started event reloads the
      // resumed session's transcript
      clearMessages();
      toast("restarting pi…");
    } else if (action === "logout") {
      localStorage.removeItem("pi_ui_token");
      document.cookie = "pi_ui_token=; path=/; max-age=0";
      location.reload();
    } else if (action === "settings") {
      await showSettingsModal();
    }
  } catch (err) {
    toast(err.message, "error");
  }
}
setMenuActionHandler(runMenuAction);

// ------------------------------------------------------------ attach file

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
async function showFilePicker(onPick = insertIntoComposer, onCancel = null, returnToHublot = false) {
  const body = $("mBody"), actions = $("mActions");
  // always open in the current session's working directory
  let startPath = workdir;

  let curDir = startPath; // tracks the folder currently being viewed
  let showHidden = true;
  const done = () => { closeModal(); if (returnToHublot) showHublots().catch((e) => toast(e.message, "error")); };

  function addHiddenToggle() {
    let t = actions.querySelector(".toggle-hidden");
    if (!t) {
      t = document.createElement("span");
      t.className = "chip toggle-hidden";
      t.addEventListener("click", async () => { showHidden = !showHidden; await load(curDir); });
      actions.append(t);
    }
    t.textContent = showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles";
  }

  async function load(path) {
    const q = path ? `&path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/browse?files=1${q}`);
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "cannot open folder", "error");
      // e.g. remembered folder was deleted — fall back to the workdir
      if (path !== workdir) return load(workdir);
      return;
    }
    curDir = data.path;
    updateModal({ title: "Attach file" });
    body.innerHTML = "";
    const pathEl = document.createElement("div");
    pathEl.className = "m-path";
    pathEl.textContent = data.path;
    body.appendChild(pathEl);

    const dirs = showHidden ? data.dirs : data.dirs.filter((d) => !d.hidden);
    const files = showHidden ? (data.files ?? []) : (data.files ?? []).filter((f) => !f.hidden);
    const addDir = (label, cls, target) => {
      const b = document.createElement("button");
      b.className = `m-option dir ${cls}`;
      b.textContent = label;
      b.addEventListener("click", () => load(target));
      body.appendChild(b);
    };
    if (data.path !== data.home) addDir("home", "homeDir", data.home);
    if (data.workdir && data.path !== data.workdir) addDir("workdir", "", data.workdir);
    if (data.parent) addDir("..", "up", data.parent);
    for (const d of dirs) {
      addDir(d.name, d.hidden ? "hidden-entry" : "", data.path.replace(/\/$/, "") + "/" + d.name);
    }
    for (const f of files) {
      const b = document.createElement("button");
      b.className = `m-option file ${f.hidden ? "hidden-entry" : ""}`.trim();
      b.textContent = f.name;
      const size = document.createElement("span");
      size.className = "f-size";
      size.textContent = fmtSize(f.size);
      b.appendChild(size);
      const full = data.path.replace(/\/$/, "") + "/" + f.name;
      b.title = full;
      b.addEventListener("click", () => {
        onPick(full);
        done();
      });
      body.appendChild(b);
    }
    if (!dirs.length && !files.length) {
      const empty = document.createElement("div");
      empty.className = "m-path";
      empty.textContent = "(empty folder)";
      body.appendChild(empty);
    }
  }

  actions.innerHTML = "";
  const useFolder = document.createElement("span");
  useFolder.className = "chip";
  useFolder.textContent = "\u{1F4C1} Use this folder";
  useFolder.title = "Insert the current folder path";
  useFolder.addEventListener("click", () => { onPick(curDir); done(); });
  addHiddenToggle();
  const cancel = document.createElement("span");
  cancel.className = "chip";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => { onCancel?.(); done(); });
  actions.append(useFolder, cancel);
  openModal({ title: "Attach file" });
  await load(startPath);
}

/** Insert text at the cursor position in the composer, padded with spaces. */
function insertIntoComposer(text) {
  const inp = $("input");
  const start = inp.selectionStart ?? inp.value.length;
  const end = inp.selectionEnd ?? start;
  const before = inp.value.slice(0, start);
  const after = inp.value.slice(end);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  inp.value = before + pad + text + padAfter + after;
  const pos = (before + pad + text).length;
  inp.setSelectionRange(pos, pos);
  inp.dispatchEvent(new Event("input")); // resize textarea
  inp.focus();
}

// ------------------------------------------------------------ folder browser

async function showFolderBrowser() {
  const body = $("mBody"), actions = $("mActions");
  let browsePath = workdir;
  let showHidden = true;
  let done = null;
  const finished = new Promise((resolve) => { done = resolve; });

  function addHiddenToggle() {
    const existing = actions.querySelector(".toggle-hidden");
    if (existing) { existing.textContent = showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles"; return; }
    const t = document.createElement("span");
    t.className = "chip toggle-hidden";
    t.textContent = showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles";
    t.addEventListener("click", async () => { showHidden = !showHidden; await load(browsePath); });
    actions.append(t);
  }

  async function load(path) {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/browse${q}`);
    const data = await res.json();
    if (!res.ok) { toast(data.error || "cannot open folder", "error"); return; }
    browsePath = data.path;
    updateModal({ title: "New session in folder" });
    body.innerHTML = "";
    const pathEl = document.createElement("div");
    pathEl.className = "m-path";
    pathEl.textContent = data.path;
    body.appendChild(pathEl);
    const dirs = showHidden ? data.dirs : data.dirs.filter((d) => !d.hidden);
    const addEntry = (label, cls, target) => {
      const b = document.createElement("button");
      b.className = `m-option dir ${cls}`;
      b.textContent = label;
      b.addEventListener("click", () => load(target));
      body.appendChild(b);
    };
    if (data.path !== data.home) addEntry("home", "homeDir", data.home);
    if (data.parent) addEntry("..", "up", data.parent);
    for (const d of dirs) {
      addEntry(d.name, d.hidden ? "hidden-entry" : "", data.path.replace(/\/$/, "") + "/" + d.name);
    }
    if (!data.dirs.length) {
      const empty = document.createElement("div");
      empty.className = "m-path";
      empty.textContent = "(no subfolders)";
      body.appendChild(empty);
    }
  }

  function showCreateRow() {
    const existing = body.querySelector(".newdir-row");
    if (existing) { existing.querySelector("input").focus(); return; }
    const row = document.createElement("div");
    row.className = "newdir-row";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "new folder name";
    const create = document.createElement("button");
    create.className = "btn";
    create.textContent = "Create";
    create.addEventListener("click", async () => {
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      create.disabled = true;
      try {
        const res = await fetch(`/mkdir`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: browsePath, name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { toast(data.error || `mkdir failed (${res.status})`, "error"); create.disabled = false; return; }
        toast(`created ${data.path}`);
        await load(data.path); // descend into the new folder
      } catch (e) {
        toast(`mkdir failed: ${e.message}`, "error");
        create.disabled = false;
      }
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") create.click();
      else if (e.key === "Escape") row.remove();
    });
    row.append(inp, create);
    // insert right below the path display
    body.insertBefore(row, body.children[1] ?? null);
    inp.focus();
  }

  actions.innerHTML = "";
  const newFolder = document.createElement("span");
  newFolder.className = "chip";
  newFolder.textContent = "New folder";
  newFolder.addEventListener("click", showCreateRow);
  const cancel = document.createElement("span");
  cancel.className = "chip";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => { closeModal(); done(null); });
  const ok = document.createElement("button");
  ok.className = "btn";
  ok.textContent = "Start session here";
  ok.style.padding = "6px 16px";
  ok.addEventListener("click", () => { closeModal(); done(browsePath); });
  actions.append(newFolder, cancel, ok);
  openModal({ title: "New session in folder" });
  await load(browsePath);

  const chosen = await finished;
  if (!chosen) return;
  try {
    // spawns a NEW runner in that folder; the current session keeps running
    const r = await openSessionRunner({ dir: chosen });
    setWorkdir(chosen);
    switchToRunner(r.id);
    toast(`folder: ${chosen}`);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ------------------------------------------------------------ tunnels

/** Send a message to the agent as if typed in the composer. */
async function sendAgentMessage(text) {
  addUserMessage({ role: "user", content: text });
  localEchoes.push(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
  } catch (e) {
    const idx = localEchoes.indexOf(text);
    if (idx !== -1) localEchoes.splice(idx, 1);
    toast(`send failed: ${e.message}`, "error");
  }
}

// ------------------------------------------------------------ file explorer
// Built-in "hublot": same modal style as the attach-file picker, but with
// per-file actions — download the file, or edit it right in the modal.

async function showFileExplorer() {
  const body = $("mBody"), actions = $("mActions");
  // always open in the current session's working directory
  let startPath = workdir;
  let curPath = startPath;
  let showHidden = true;

  function addHiddenToggle() {
    let t = actions.querySelector(".toggle-hidden");
    if (!t) {
      t = document.createElement("span");
      t.className = "chip toggle-hidden";
      t.addEventListener("click", async () => { showHidden = !showHidden; await load(curPath); });
      actions.append(t);
    }
    t.textContent = showHidden ? "👁️ Hide dotfiles" : "👁️ Show dotfiles";
  }

  async function load(path) {
    const q = path ? `&path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/browse?files=1${q}`);
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "cannot open folder", "error");
      if (path !== workdir) return load(workdir);
      return;
    }
    curPath = data.path;
    updateModal({ title: "\u{1F4C1} File explorer" });
    body.innerHTML = "";
    const pathEl = document.createElement("div");
    pathEl.className = "m-path";
    pathEl.textContent = data.path;
    body.appendChild(pathEl);

    const dirs = showHidden ? data.dirs : data.dirs.filter((d) => !d.hidden);
    const files = showHidden ? (data.files ?? []) : (data.files ?? []).filter((f) => !f.hidden);
    const addDir = (label, cls, target) => {
      const b = document.createElement("button");
      b.className = `m-option dir ${cls}`;
      b.textContent = label;
      b.addEventListener("click", () => load(target));
      body.appendChild(b);
    };
    if (data.path !== data.home) addDir("home", "homeDir", data.home);
    if (data.workdir && data.path !== data.workdir) addDir("workdir", "", data.workdir);
    if (data.parent) addDir("..", "up", data.parent);
    for (const d of dirs) {
      addDir(d.name, d.hidden ? "hidden-entry" : "", data.path.replace(/\/$/, "") + "/" + d.name);
    }
    for (const f of files) {
      const full = data.path.replace(/\/$/, "") + "/" + f.name;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;";
      const b = document.createElement("button");
      b.className = `m-option file ${f.hidden ? "hidden-entry" : ""}`.trim();
      b.style.cssText = "flex:1;min-width:0;";
      b.textContent = f.name;
      const size = document.createElement("span");
      size.className = "f-size";
      size.textContent = fmtSize(f.size);
      b.appendChild(size);
      b.title = full;
      b.addEventListener("click", () => editFile(full));
      const dl = document.createElement("a");
      dl.className = "chip";
      dl.textContent = "\u2B07";
      dl.title = `download ${f.name}`;
      dl.href = `/file-download?token=${encodeURIComponent(token)}&path=${encodeURIComponent(full)}`;
      dl.setAttribute("download", f.name);
      dl.style.textDecoration = "none";
      const ed = document.createElement("span");
      ed.className = "chip";
      ed.textContent = "\u270E";
      ed.title = `edit ${f.name}`;
      ed.addEventListener("click", () => editFile(full));
      row.append(b, dl, ed);
      body.appendChild(row);
    }
    if (!dirs.length && !files.length) {
      const empty = document.createElement("div");
      empty.className = "m-path";
      empty.textContent = "(empty folder)";
      body.appendChild(empty);
    }

    actions.innerHTML = "";
    const up = document.createElement("span");
    up.className = "chip";
    up.textContent = "\u2B06 Upload\u2026";
    up.title = `upload local files to ${data.path}`;
    up.addEventListener("click", () => uploadFiles(data.path, up));
    const back = document.createElement("span");
    back.className = "chip";
    back.textContent = "\u2190 Hublots";
    back.addEventListener("click", () => showHublots().catch((e) => toast(e.message, "error")));
    addHiddenToggle();
    const closeBtn = document.createElement("span");
    closeBtn.className = "chip";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeModal);
    actions.append(up, back, closeBtn);
  }

  function uploadFiles(dir, chip) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.addEventListener("change", async () => {
      const files = [...inp.files];
      if (!files.length) return;
      const CHUNK = 8 * 1024 * 1024; // 8 MB — safe through server cap and cloudflare tunnel
      const MAX_RETRIES = 6;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
      let uploadedBytes = 0;
      const setProgress = () => {
        if (!chip) return;
        chip.innerHTML = `<span class="spin">\u27F3</span> ${Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))}%`;
      };
      if (chip) chip.style.pointerEvents = "none";
      setProgress();
      let done = 0;
      for (const f of files) {
        try {
          let offset = 0;
          let attempts = 0;
          let finished = false;
          while (!finished) {
            const end = Math.min(offset + CHUNK, f.size);
            const isLast = end >= f.size;
            let r, d;
            try {
              r = await fetch(
                `/file-upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}` +
                  `&offset=${offset}&last=${isLast ? 1 : 0}`,
                { method: "POST", body: f.slice(offset, end) }
              );
              d = await r.json().catch(() => ({}));
            } catch {
              // network drop / tunnel hiccup — retry same chunk with backoff
              if (++attempts > MAX_RETRIES) throw new Error(`connection lost (gave up after ${MAX_RETRIES} retries)`);
              await sleep(1000 * attempts);
              continue;
            }
            if (r.ok) {
              attempts = 0;
              if (isLast || d.saved) finished = true;
              else offset = typeof d.received === "number" ? d.received : end;
              uploadedBytes = files.slice(0, done).reduce((s, x) => s + x.size, 0) + (finished ? f.size : offset);
              setProgress();
              continue;
            }
            if (r.status === 409 && typeof d.have === "number") {
              // server tells us how much it actually has — resume from there
              if (++attempts > MAX_RETRIES) throw new Error(d.error || "upload out of sync");
              offset = d.have;
              continue;
            }
            if (r.status >= 500 || r.status === 429) {
              if (++attempts > MAX_RETRIES) throw new Error(d.error || `upload failed (${r.status})`);
              await sleep(1000 * attempts);
              continue;
            }
            throw new Error(d.error || `upload failed (${r.status})`);
          }
          done++;
        } catch (e) {
          toast(`${f.name}: ${e.message}`, "error");
        }
      }
      if (done) toast(`uploaded ${done} file${done > 1 ? "s" : ""} to ${dir}`);
      await load(dir); // refresh the listing (rebuilds the chip)
    });
    inp.click();
  }

  async function editFile(path) {
    const res = await fetch(`/file-content?path=${encodeURIComponent(path)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "cannot open file", "error"); return; }

    updateModal({ title: `\u270E ${path.split("/").pop()}` });
    body.innerHTML = "";
    const pathEl = document.createElement("div");
    pathEl.className = "m-path";
    pathEl.textContent = path;
    const ta = document.createElement("textarea");
    ta.value = data.content;
    ta.spellcheck = false;
    ta.style.cssText = "width:100%;height:50vh;resize:vertical;font:12.5px/1.5 ui-monospace,monospace;white-space:pre;tab-size:4;box-sizing:border-box;margin-top:6px;";
    body.append(pathEl, ta);

    actions.innerHTML = "";
    const save = document.createElement("span");
    save.className = "chip";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.textContent = "Saving\u2026";
      try {
        const r = await fetch(`/file-save`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, content: ta.value }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `save failed (${r.status})`);
        toast(`saved ${path.split("/").pop()} (${d.bytes} bytes)`);
      } catch (e) {
        toast(e.message, "error");
      } finally {
        save.textContent = "Save";
      }
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save.click(); }
    });
    const dl = document.createElement("a");
    dl.className = "chip";
    dl.textContent = "Download";
    dl.href = `/file-download?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
    dl.setAttribute("download", path.split("/").pop());
    dl.style.textDecoration = "none";
    const back = document.createElement("span");
    back.className = "chip";
    back.textContent = "\u2190 Back";
    back.addEventListener("click", () => load(curPath));
    const closeBtn = document.createElement("span");
    closeBtn.className = "chip";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeModal);
    actions.append(save, dl, back, closeBtn);
  }

  openModal({ title: "\u{1F4C1} File explorer" });
  await load(startPath);
}

// Tunnels are bound to the session they were opened in; the modal and the
// hublot sidebar show the current session's tunnels by default, with a
// toggle to see every session's.
let tunnelScopeAll = false;

function tunnelVisible(t) {
  // unbound tunnels (opened before session binding existed) stay visible
  return tunnelScopeAll || !t.sessionId || t.sessionId === state?.sessionId;
}

// new-tunnel form values survive modal re-renders (e.g. attach-file detour)
const tunnelForm = { desc: "" };

async function showHublots() {
  const body = $("mBody"), actions = $("mActions");
  // close the slide-over sidebars so they don't sit on top of the modal
  $("hublots").classList.remove("open");
  $("treebar").classList.remove("open");

  async function load() {
    const res = await fetch(`/tunnels`);
    const data = await res.json();
    if (!res.ok) { toast(data.error || "failed to load tunnels", "error"); return; }
    const visible = data.tunnels.filter(tunnelVisible);
    updateModal({ title: tunnelScopeAll ? "Hublots — all sessions" : "Hublots — this session" });
    body.innerHTML = "";

    // ---- built-in hublots (always on top)
    const fxRow = document.createElement("div");
    fxRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0 10px;border-bottom:1px solid var(--border,#333);margin-bottom:8px;";
    const fxBtn = document.createElement("button");
    fxBtn.className = "btn";
    fxBtn.textContent = "\u{1F4C1} File explorer";
    const fxDesc = document.createElement("span");
    fxDesc.className = "m-path";
    fxDesc.style.cssText = "flex:1;min-width:0;";
    fxDesc.textContent = "built-in — browse server files, download or edit any of them";
    fxBtn.addEventListener("click", () => showFileExplorer().catch((e) => toast(e.message, "error")));
    fxRow.append(fxBtn, fxDesc);
    body.appendChild(fxRow);

    // ---- active tunnels
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "m-path";
      empty.textContent = tunnelScopeAll
        ? "(no active hublots)"
        : data.tunnels.length
          ? `(none for this session — ${data.tunnels.length} in other sessions)`
          : "(no active hublots)";
      body.appendChild(empty);
    }
    if (visible.length) {
      const grid = document.createElement("div");
      grid.className = "hublot-grid";
      for (const t of visible) {
        const block = document.createElement("div");
        block.className = "hublot-block";

        const preview = document.createElement("div");
        preview.className = "preview";
        const frame = document.createElement("iframe");
        frame.src = t.url;
        frame.loading = "lazy";
        frame.sandbox = "allow-scripts allow-same-origin";
        const hit = document.createElement("div");
        hit.className = "hit";
        hit.title = `open ${t.url}`;
        hit.addEventListener("click", () => window.open(t.url, "_blank", "noopener"));
        preview.append(frame, hit);

        const cap = document.createElement("div");
        cap.className = "cap";
        const lbl = document.createElement("span");
        lbl.className = "lbl";
        const bits = [`:${t.port}`, t.label];
        if (tunnelScopeAll && t.sessionId) {
          bits.push(t.sessionId === state?.sessionId ? "this session" : `session ${String(t.sessionId).slice(0, 8)}`);
        }
        lbl.textContent = bits.filter(Boolean).join(" · ");
        lbl.title = `${t.url}\n${t.label ?? ""}`;
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "✕";
        x.title = "close this hublot";
        x.addEventListener("click", async () => {
          await fetch(`/tunnels?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
          await load();
          loadHublots();
        });
        cap.append(lbl, x);

        block.append(preview, cap);
        grid.appendChild(block);
      }
      body.appendChild(grid);
    }

    // ---- new tunnel form
    const form = document.createElement("div");
    form.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:12px;border-top:1px solid var(--border,#333);padding-top:12px;";
    const heading = document.createElement("div");
    heading.style.cssText = "font-weight:600;font-size:13.5px;";
    heading.textContent = "New hublot";
    const descRow = document.createElement("div");
    descRow.style.cssText = "display:flex;gap:6px;align-items:flex-start;";
    const descInp = document.createElement("textarea");
    descInp.rows = 3;
    descInp.placeholder = "What should the agent expose through this hublot? (e.g. “the vite dev server for the dashboard, with hot reload”)";
    descInp.style.cssText = "resize:vertical;flex:1;min-width:0;";
    descInp.value = tunnelForm.desc;
    descInp.addEventListener("input", () => { tunnelForm.desc = descInp.value; });
    setupCommandPalette(descInp);
    descRow.append(descInp);
    const create = document.createElement("button");
    create.className = "btn";
    create.textContent = "Open hublot";
    create.addEventListener("click", async () => {
      const desc = descInp.value.trim();
      if (!desc) { descInp.focus(); toast("describe what the hublot should expose", "warning"); return; }
      create.disabled = true;
      create.textContent = "Opening…";
      try {
        // no port sent: the server allocates the next free one from 3000 up;
        // a `brief` makes the server hand the setup to a background pi agent
        const res2 = await fetch(`/tunnels`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: desc || null,
            sessionId: state?.sessionId ?? null,
            brief: desc,
          }),
        });
        const d2 = await res2.json().catch(() => ({}));
        if (!res2.ok) { toast(d2.error || `failed (${res2.status})`, "error"); return; }
        tunnelForm.desc = "";
        closeModal();
        toast(`hublot opening at ${d2.tunnel.url} — background agent is setting it up…`);
      } catch (e) {
        toast(`hublot failed: ${e.message}`, "error");
      } finally {
        create.disabled = false;
        create.textContent = "Open hublot";
      }
    });
    form.append(heading, descRow, create);
    body.appendChild(form);

    actions.innerHTML = "";
    const scope = document.createElement("span");
    scope.className = "chip";
    scope.textContent = tunnelScopeAll ? "This session only" : "All sessions";
    scope.title = "toggle between this session's tunnels and all of them";
    scope.addEventListener("click", async () => {
      tunnelScopeAll = !tunnelScopeAll;
      await load();
      loadHublots(); // keep the sidebar in the same scope
      syncRoutinesStore(); // the routines section shares the scope toggle
    });
    const closeBtn = document.createElement("span");
    closeBtn.className = "chip";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeModal);
    actions.append(scope, closeBtn);
  }

  openModal({ title: tunnelScopeAll ? "Hublots — all sessions" : "Hublots — this session", wide: true });
  await load();
}

// ------------------------------------------------------------ hublot sidebar

$("hublotAdd").addEventListener("click", () => showHublots().catch((e) => toast(e.message, "error")));

// mobile: toggle the hublots sidebar as a slide-over drawer
// tap outside the drawer closes it (mobile only — on desktop they're
// docked, not overlays). Sync the carousel state so applyCarousel()
// doesn't immediately re-open it.
document.addEventListener("click", (e) => {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  const hublots = $("hublots");
  const treebar = $("treebar");
  if (!hublots.contains(e.target) && !treebar.contains(e.target) &&
      !e.target.closest("#hublotChip") && !e.target.closest("#treeChip")) {
    if (hublots.classList.contains("open") || treebar.classList.contains("open")) {
      hublots.classList.remove("open");
      treebar.classList.remove("open");
      carousel = 0;
      localStorage.setItem("pi_carousel", "0");
      setCarouselDots();
    }
  }
});

async function loadHublots() {
  if (!token) return;
  hublotsLoading.set(true);
  let tunnels = [];
  try {
    const res = await fetch(`/tunnels`);
    const data = await res.json();
    if (res.ok) tunnels = data.tunnels.filter(tunnelVisible);
  } catch { /* sidebar is best-effort */ }
  hublots.set(tunnels);
  hublotsLoading.set(false);
}

async function closeHublot(id) {
  await fetch(`/tunnels?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  loadHublots();
}

setHublotHandlers({
  openFileExplorer: () => showFileExplorer().catch((e) => toast(e.message, "error")),
  closeHublot,
});

// ------------------------------------------------------------ routines sidebar
//
// A routine is an executable script in ~/.pi/routines/ (global store).
// Starting one binds it to the current session (and that session's workdir,
// where run/teardown execute). Unbound routines are visible everywhere;
// bound ones only in their session (the hublot scope toggle also applies
// here). The server runs `<script> run` on start, kills its process group
// on stop, and runs `<script> teardown` to remove byproducts. Scripts report
// progression by printing `::progress <0-100> <message>` lines on stdout.

let routinesNow = [];
let routinesLoadSeq = 0;

function syncRoutinesStore({ loading = false } = {}) {
  routines.set(routinesNow.filter(routineVisible));
  routinesTotal.set(routinesNow.length);
  routineScopeAll.set(tunnelScopeAll);
  routineCurrentSessionId.set(state?.sessionId ?? null);
  routinesLoading.set(loading);
}

function routineVisible(r) {
  return tunnelScopeAll || !r.sessionId || r.sessionId === state?.sessionId;
}

async function loadRoutines() {
  if (!token) return;
  const seq = ++routinesLoadSeq;
  const sessionAtStart = state?.sessionId ?? null;
  routinesLoading.set(true);
  routines.set([]);
  routineScopeAll.set(tunnelScopeAll);
  routineCurrentSessionId.set(sessionAtStart);
  try {
    const res = await fetch(`/routines`);
    const data = await res.json();
    if (res.ok) routinesNow = data.routines ?? [];
  } catch { /* sidebar is best-effort */ }
  // Session switches can issue overlapping sidebar refreshes; ignore stale
  // responses so the previous session's routines don't overwrite the current view.
  if (seq !== routinesLoadSeq || sessionAtStart !== (state?.sessionId ?? null)) return;
  syncRoutinesStore({ loading: false });
}

async function routineAction(name, action) {
  try {
    const res = await fetch(`/routines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // start binds the routine to the current session (and its workdir)
      body: JSON.stringify({ name, action, sessionId: state?.sessionId ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast(data.error || `routine ${action} failed (${res.status})`, "error");
  } catch (e) {
    toast(`routine ${action} failed: ${e.message}`, "error");
  }
  loadRoutines();
}
setRoutineHandlers({ runAction: routineAction });

// ------------------------------------------------------------ session picker

function fmtSessionDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function showSessionPicker() {
  // list the sessions of the CURRENT session's directory, not the server's
  // last-set global workdir
  const dirQ = workdir ? `?dir=${encodeURIComponent(workdir)}` : "";
  const res = await fetch(`/sessions${dirQ}`);
  if (!res.ok) { toast(`failed to list sessions (${res.status})`, "error"); return; }
  const { sessions } = await res.json();
  if (!sessions.length) { toast("no saved sessions"); return; }
  const currentId = state?.sessionId;

  const dots = new Map(); // session path -> { dot, stop } (live indicator updates)
  const applyDot = (entry, alive, busy) => {
    entry.dot.className = "s-dot" + (busy ? " busy" : alive ? " on" : "");
    entry.dot.title = busy ? "agent working" : alive ? "process running (idle)" : "no running process";
    if (entry.stop) entry.stop.style.display = alive ? "" : "none";
  };
  onRunnersUpdate = (runners) => {
    for (const [path, entry] of dots) {
      const r = runners.find((x) => x.sessionFile === path);
      applyDot(entry, !!r?.alive, !!r?.busy);
    }
  };

  // folders for the search scope selector and the "other folders" section
  let folders = [], currentFolder = null;
  try {
    const r = await fetch(`/session-folders${dirQ}`);
    const d = await r.json();
    if (r.ok) { folders = d.folders; currentFolder = d.current; }
  } catch {}

  const chosen = await new Promise((resolve) => {
    updateModal({ title: "Sessions" });
    const body = $("mBody");
    body.innerHTML = "";

    // ---- search bar (typing swaps the list for search results)
    const row = document.createElement("div");
    row.className = "search-row";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "search sessions…";
    const scopeSel = document.createElement("select");
    scopeSel.innerHTML = `
      <option value="session">This session</option>
      <option value="folder">Folder…</option>
      <option value="all" selected>All sessions</option>`;
    row.append(inp, scopeSel);

    const folderRow = document.createElement("div");
    folderRow.className = "search-row";
    const folderSel = document.createElement("select");
    folderSel.style.maxWidth = "100%";
    folderSel.style.flex = "1";
    for (const f of folders) {
      const o = document.createElement("option");
      o.value = f.dir;
      o.textContent = `${f.label} (${f.count})`;
      if (f.dir === currentFolder) o.selected = true;
      folderSel.appendChild(o);
    }
    folderRow.appendChild(folderSel);

    // search only real text responses by default; tool output is opt-in
    const optsRow = document.createElement("label");
    optsRow.className = "search-opts";
    const toolsCb = document.createElement("input");
    toolsCb.type = "checkbox";
    toolsCb.checked = true;
    optsRow.append(toolsCb, "exclude tool output (search only user/ai text)");
    toolsCb.addEventListener("change", () => { if (searching()) run(); });

    const status = document.createElement("div");
    status.className = "m-path";
    const resultsEl = document.createElement("div");
    const listEl = document.createElement("div"); // the plain sessions list

    function searching() { return inp.value.trim().length >= 2; }
    function updateView() {
      listEl.style.display = searching() ? "none" : "";
      status.style.display = searching() ? "" : "none";
      resultsEl.style.display = searching() ? "" : "none";
      folderRow.style.display = searching() && scopeSel.value === "folder" ? "" : "none";
      optsRow.style.display = searching() ? "" : "none";
      if (!searching()) resultsEl.innerHTML = "";
    }

    let runSeq = 0; // ignore out-of-order responses from stale keystrokes
    async function run() {
      const seq = ++runSeq;
      updateView();
      if (!searching()) return;
      const q = inp.value.trim();
      const scope = scopeSel.value;
      let path = "";
      if (scope === "folder") path = folderSel.value ?? "";
      if (scope === "session") {
        const cur = sessions.find((s) => s.id === currentId) ?? sessions[0];
        if (!cur) { status.textContent = "no saved session to search"; return; }
        path = cur.path;
      }
      status.textContent = "searching…";
      resultsEl.innerHTML = "";
      const params = new URLSearchParams({ token, q, scope });
      if (path) params.set("path", path);
      if (!toolsCb.checked) params.set("tools", "1"); // toggle off → include tool output
      let data;
      try {
        const r = await fetch(`/search?${params}`);
        data = await r.json();
        if (seq !== runSeq) return; // a newer query superseded this one
        if (!r.ok) { status.textContent = data.error || `search failed (${r.status})`; return; }
      } catch (e) {
        if (seq !== runSeq) return;
        status.textContent = `search failed: ${e.message}`;
        return;
      }

      status.textContent = `${data.results.length} hit${data.results.length === 1 ? "" : "s"} in ${data.filesSearched} file${data.filesSearched === 1 ? "" : "s"}` + (data.truncated ? " (truncated)" : "");
      if (!data.results.length) return;

      // group hits by session file
      const groups = new Map();
      for (const h of data.results) {
        if (!groups.has(h.sessionPath)) groups.set(h.sessionPath, []);
        groups.get(h.sessionPath).push(h);
      }
      for (const [sessionPath, hits] of groups) {
        const first = hits[0];
        const b = document.createElement("button");
        b.className = "m-option search-hit";
        const title = document.createElement("div");
        title.className = "s-title";
        const nameEl = document.createElement("span");
        nameEl.className = "s-name";
        nameEl.textContent = first.sessionName || first.sessionPreview || "(unnamed session)";
        const dateEl = document.createElement("span");
        dateEl.className = "s-date";
        dateEl.textContent = `${scope === "all" ? first.folderLabel + " · " : ""}${hits.length} hit${hits.length === 1 ? "" : "s"}`;
        title.append(nameEl, dateEl);
        b.appendChild(title);
        hits.slice(0, 3).forEach((h, hi) => {
          const sn = document.createElement("div");
          sn.className = "s-snippet";
          sn._hitIndex = hi;
          const role = document.createElement("span");
          role.className = "s-role";
          role.textContent = h.role === "user" ? "you" : h.role === "assistant" ? "ai"
            : h.role === "toolResult" ? "tool" : h.kind;
          const mark = document.createElement("mark");
          mark.textContent = h.snippet.match;
          sn.append(role, " ", document.createTextNode(h.snippet.before), mark, document.createTextNode(h.snippet.after));
          b.appendChild(sn);
        });
        if (hits.length > 3) {
          const more = document.createElement("div");
          more.className = "s-snippet";
          more.textContent = `…and ${hits.length - 3} more in this session`;
          b.appendChild(more);
        }
        b.title = sessionPath;
        b.addEventListener("click", (e) => {
          // clicking a specific snippet focuses that hit; the card itself uses the first hit
          const idx = e.target.closest?.(".s-snippet")?._hitIndex;
          resolve(null); // settle the picker promise; openSearchHit takes over
          openSearchHit(sessionPath, hits[idx ?? 0] ?? first);
        });
        resultsEl.appendChild(b);
      }
    }

    // live search: debounce keystrokes; Enter searches immediately
    let debounce = null;
    inp.addEventListener("input", () => {
      clearTimeout(debounce);
      updateView();
      debounce = setTimeout(run, 250);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { clearTimeout(debounce); run(); }
    });
    scopeSel.addEventListener("change", () => { updateView(); if (searching()) run(); });
    folderSel.addEventListener("change", () => { if (searching()) run(); });

    body.append(row, folderRow, optsRow, status, resultsEl, listEl);
    updateView();
    setTimeout(() => inp.focus(), 0);

    function addSessionRow(s, container) {
      const isCurrent = s.id === currentId;
      const b = document.createElement("button");
      b.className = "m-option" + (isCurrent ? " current" : "");
      const title = document.createElement("div");
      title.className = "s-title";
      const dot = document.createElement("span");
      title.appendChild(dot);
      const nameEl = document.createElement("span");
      nameEl.className = "s-name";
      nameEl.textContent = (s.name || s.preview || "(empty session)") + (isCurrent ? " · current" : "");
      const dateEl = document.createElement("span");
      dateEl.className = "s-date";
      dateEl.textContent = `${fmtSessionDate(s.modifiedAt)} · ${s.messageCount} msgs`;
      title.append(nameEl, dateEl);
      // stop (■): kill the session's background process; the session file
      // and its work stay on disk
      const stop = document.createElement("span");
      stop.className = "s-del s-stop";
      stop.textContent = "■";
      stop.title = "Stop this session's process (keeps the session)";
      stop.addEventListener("click", async (e) => {
        e.stopPropagation();
        const r = runnersNow.find((x) => x.sessionFile === s.path) ?? { id: s.runnerId };
        if (!r.id) return;
        try {
          const res2 = await fetch(`/runners?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
          const d2 = await res2.json().catch(() => ({}));
          if (!res2.ok) { toast(d2.error || `stop failed (${res2.status})`, "error"); return; }
          toast("process stopped");
        } catch (err) {
          toast(`stop failed: ${err.message}`, "error");
        }
      });
      title.appendChild(stop);
      const entry = { dot, stop };
      applyDot(entry, s.alive, s.busy);
      dots.set(s.path, entry);

      if (!isCurrent) {
        const del = document.createElement("span");
        del.className = "s-del";
        del.textContent = "✕";
        del.title = "Delete session";
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete session "${s.name || s.preview || s.id?.slice(0, 8) || "?"}"?`)) return;
          try {
            const r = await fetch(`/session?path=${encodeURIComponent(s.path)}`, { method: "DELETE" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { toast(d.error || `delete failed (${r.status})`, "error"); return; }
            b.remove();
            const bits = [];
            if (d.closedHublots?.length) bits.push(`closed hublot${d.closedHublots.length > 1 ? "s" : ""} :${d.closedHublots.join(", :")}`);
            if (d.releasedRoutines?.length) bits.push(`released routine${d.releasedRoutines.length > 1 ? "s" : ""} ${d.releasedRoutines.join(", ")}`);
            toast(bits.length ? `session deleted · ${bits.join(" · ")}` : "session deleted");
            if (d.closedHublots?.length) loadHublots();
            if (d.releasedRoutines?.length) loadRoutines();
          } catch (err) {
            toast(`delete failed: ${err.message}`, "error");
          }
        });
        title.appendChild(del);
      }
      b.appendChild(title);
      if (s.name && s.preview) {
        const prev = document.createElement("div");
        prev.className = "s-preview";
        prev.textContent = s.preview;
        b.appendChild(prev);
      }
      b.addEventListener("click", () => { closeModal(); resolve(s); });
      container.appendChild(b);
    }


    // ---- active sessions first, then inactive ones (both sectioned by workdir)
    const folderOf = (p) => p.slice(0, p.lastIndexOf("/"));
    const labelFor = (dir) =>
      folders.find((f) => f.dir === dir)?.label ?? (dir === currentFolder ? workdir : dir) ?? "?";

    /** group a session list into fork families: forks (sessions whose
     *  parentSession chain leads to another session IN the list) collapse
     *  under their top-most ancestor present in the list */
    function forkFamilies(list) {
      const byPath = new Map(list.map((s) => [s.path, s]));
      const rootOf = (s) => {
        const seen = new Set();
        while (s.parentSession && byPath.has(s.parentSession) && !seen.has(s.path)) {
          seen.add(s.path);
          s = byPath.get(s.parentSession);
        }
        return s;
      };
      const families = new Map(); // root path -> { session, forks }
      for (const s of list) {
        const root = rootOf(s);
        if (!families.has(root.path)) families.set(root.path, { session: root, forks: [] });
        if (s.path !== root.path) families.get(root.path).forks.push(s);
      }
      return [...families.values()];
    }

    /** render session rows with forks collapsed under their main session */
    function addSessionRows(list, container) {
      for (const fam of forkFamilies(list)) {
        addSessionRow(fam.session, container);
        if (!fam.forks.length) continue;
        const det = document.createElement("details");
        det.className = "s-forkgroup";
        const sum = document.createElement("summary");
        sum.textContent = `\u{1F33F} ${fam.forks.length} fork${fam.forks.length === 1 ? "" : "s"}`;
        det.appendChild(sum);
        for (const f of fam.forks) addSessionRow(f, det);
        // never hide the session the user is currently in
        if (fam.forks.some((f) => f.id === currentId)) det.open = true;
        container.appendChild(det);
      }
    }
    const addHeader = (text, container) => {
      const h = document.createElement("div");
      h.className = "s-section";
      h.textContent = text;
      container.appendChild(h);
    };
    const addFolderLabel = (dir, container) => {
      const l = document.createElement("div");
      l.className = "s-wd";
      const ico = document.createElement("span");
      ico.className = "s-ico";
      ico.textContent = "\u{1F4C1}";
      l.append(ico, ` ${labelFor(dir)}`);
      container.appendChild(l);
    };

    // partition WHOLE fork families: a family is "active" if any member has a
    // live process, so forks always stay collapsed under their main session
    // instead of scattering across the two sections
    const activeCur = [], inactiveCur = [];
    for (const fam of forkFamilies(sessions)) {
      const members = [fam.session, ...fam.forks];
      (members.some((s) => s.alive) ? activeCur : inactiveCur).push(...members);
    }

    // active sessions living in OTHER folders, discovered via live runners
    const activeOther = new Map(); // session folder dir -> Set(session paths)
    for (const r of runnersNow) {
      if (!r.alive || !r.sessionFile) continue;
      const fd = folderOf(r.sessionFile);
      if (fd === currentFolder) continue;
      if (!activeOther.has(fd)) activeOther.set(fd, new Set());
      activeOther.get(fd).add(r.sessionFile);
    }

    if (activeCur.length || activeOther.size) {
      addHeader("Active sessions", listEl);
      if (activeCur.length) {
        addFolderLabel(currentFolder, listEl);
        addSessionRows(activeCur, listEl);
      }
      for (const [fd, paths] of activeOther) {
        const holder = document.createElement("div");
        addFolderLabel(fd, holder);
        listEl.appendChild(holder);
        // fetch that folder's session summaries to render full rows
        fetch(`/sessions?path=${encodeURIComponent(fd)}`)
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .then(({ ok, d }) => {
            if (!ok) throw new Error(d.error || "failed");
            const rows = d.sessions.filter((x) => paths.has(x.path));
            if (!rows.length) return holder.remove(); // no session -> hide the directory
            addSessionRows(rows, holder);
            onRunnersUpdate?.(runnersNow); // sync freshly added dots
          })
          .catch(() => holder.remove());
      }
    }

    // ---- inactive sessions, sectioned by workdir
    const others = folders.filter((f) => f.dir !== currentFolder);
    if (inactiveCur.length || others.length) addHeader("Inactive sessions", listEl);
    if (inactiveCur.length) {
      addFolderLabel(currentFolder, listEl);
      addSessionRows(inactiveCur, listEl);
    }

    // collapsed section: inactive sessions from other folders
    (() => {
      if (!others.length) return;

      const section = document.createElement("details");
      section.className = "s-folders";
      const sum = document.createElement("summary");
      sum.textContent = `Other folders (${others.length})`;
      section.appendChild(sum);

      for (const f of others) {
        const fd = document.createElement("details");
        fd.className = "s-folder";
        const fsum = document.createElement("summary");
        const fico = document.createElement("span");
        fico.className = "s-ico";
        fico.textContent = "📁";
        fsum.append(fico, ` ${f.label} (${f.count})`);
        fd.appendChild(fsum);
        // lazy-load the folder's sessions on first expand
        let loaded = false;
        fd.addEventListener("toggle", async () => {
          if (!fd.open || loaded) return;
          loaded = true;
          try {
            const r = await fetch(`/sessions?path=${encodeURIComponent(f.dir)}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || `failed (${r.status})`);
            const inactive = d.sessions.filter((s) => !s.alive); // active ones are shown above
            if (!inactive.length) {
              const empty = document.createElement("div");
              empty.className = "m-path";
              empty.textContent = "(no inactive sessions)";
              fd.appendChild(empty);
            }
            addSessionRows(inactive, fd);
            onRunnersUpdate?.(runnersNow); // sync freshly added dots
          } catch (e) {
            loaded = false;
            toast(`failed to list ${f.label}: ${e.message}`, "error");
          }
        });
        section.appendChild(fd);
      }
      listEl.appendChild(section);
    })();

    const actions = $("mActions");
    const cancel = document.createElement("span");
    cancel.className = "chip";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { closeModal(); resolve(null); });
    actions.appendChild(cancel);
    openModal({ title: "Sessions" });
  });

  onRunnersUpdate = null;
  if (!chosen || chosen.id === currentId) return;
  try {
    // attaches to the session's live runner if it has one (its work is
    // untouched), else spawns a fresh pi on that session in the background;
    // sessions from other folders spawn in their own recorded cwd
    const r = await openSessionRunner({ sessionPath: chosen.path, dir: chosen.cwd || workdir });
    switchToRunner(r.id);
    toast(`switched to: ${chosen.name || chosen.preview || chosen.id.slice(0, 8)}`);
  } catch (e) {
    toast(`switch failed: ${e.message}`, "error");
  }
}

async function chooseModel() {
  try {
    const { models } = await rpc({ type: "get_available_models" });
    const choice = await pickOption(
      "Select model",
      models.map((m) => `${m.provider}/${m.id}`),
      { searchable: true }
    );
    if (choice == null) return;
    const m = models[choice];
    await rpc({ type: "set_model", provider: m.provider, modelId: m.id });
    toast(`model: ${m.id}`);
  } catch (e) { toast(e.message, "error"); }
}

async function cycleThinking() {
  try {
    const data = await rpc({ type: "cycle_thinking_level" });
    if (data) toast(`thinking: ${data.level}`);
    refreshState();
  } catch (e) { toast(e.message, "error"); }
}

async function openConfigPicker() {
  const which = await pickOption("Settings", [
    `Model: ${state?.model?.id ?? "?"} — change…`,
    `Thinking: ${state?.thinkingLevel ?? "?"} — cycle`,
  ]);
  if (which === 0) await chooseModel();
  else if (which === 1) await cycleThinking();
}

// ------------------------------------------------------------ session search

/** Switch to the hit's session (if needed) and scroll to / flash the message
 *  containing the matched text. Rendered messages carry no entry ids, so we
 *  locate the bubble by matching the snippet text, longest form first. */
async function openSearchHit(sessionPath, hit) {
  closeModal();
  if (hit.sessionId === state?.sessionId) {
    if (!focusMessageBySnippet(hit.snippet)) toast("match not visible in transcript", "warning");
    return;
  }

  const focus = () => {
    if (!focusMessageBySnippet(hit.snippet)) toast("match not visible in transcript", "warning");
  };

  try {
    // attach to the session's runner (spawned in the session's own folder if
    // it comes from elsewhere); other sessions keep running untouched
    const r = await openSessionRunner({ sessionPath, dir: hit.sessionCwd || workdir });
    if (hit.sessionCwd) setWorkdir(hit.sessionCwd);
    toast(`switched to: ${hit.sessionName || hit.sessionPreview || "session"}`);
    if (r.id === currentRunner) {
      await reloadTranscript();
      focus();
    } else {
      afterTranscript = focus;
      switchToRunner(r.id);
    }
  } catch (e) {
    toast(`switch failed: ${e.message}`, "error");
  }
}

function focusMessageBySnippet(snippet) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const full = norm(snippet.before.replace(/^…/, "") + snippet.match + snippet.after.replace(/…$/, ""));
  // longest needle first; fall back to just the matched text
  const needles = [full, norm(snippet.match)].filter(Boolean);
  const els = [...messagesEl.children];
  for (const needle of needles) {
    const el = els.find((e) => norm(e.textContent).includes(needle));
    if (!el) continue;
    // open any collapsed tool cards that contain the match so it is visible
    for (const det of el.querySelectorAll("details")) {
      if (norm(det.textContent).includes(needle)) det.open = true;
    }
    flashEl(el);
    return true;
  }
  return false;
}

function flashEl(el) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-flash");
  setTimeout(() => el.classList.add("fading"), 1500);
  setTimeout(() => el.classList.remove("msg-flash", "fading"), 3000);
}

// ------------------------------------------------------------ message permalinks
//
// Every user/assistant message can be shared as /s/<sessionId>/m/<entryId>.
// Entry ids come from the session's .jsonl (via /session-entries, which
// returns the ACTIVE branch in order); the rendered transcript carries no
// ids, so elements and entries are zipped together by position, with a
// text-match fallback when the two sides disagree (e.g. mid-stream).

function addPermalinkBtn(el) {
  const b = document.createElement("span");
  b.className = "permalink";
  b.textContent = "\u{1F517}";
  b.title = "copy a permalink to this message";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    copyPermalink(el).catch((err) => toast(`permalink failed: ${err.message}`, "error"));
  });
  el.appendChild(b);
}

/** rendered transcript elements that correspond to persisted user/assistant entries */
function chatEls() {
  return [...messagesEl.children].filter(
    (el) => el.dataset.role === "user" || el.dataset.role === "assistant"
  );
}

async function fetchSessionEntries() {
  const path = state?.sessionFile
    ?? runnersNow.find((r) => r.id === currentRunner)?.sessionFile;
  if (!path) throw new Error("session not saved yet");
  const res = await fetch(`/session-entries?path=${encodeURIComponent(path)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
  return data.entries ?? [];
}

const normText = (s) => s.replace(/\s+/g, " ").trim();

/** does this entry plausibly describe this element? (labels like "[tool: …]"
 *  never appear verbatim in the DOM, so only verify real text) */
function entryMatchesEl(entry, el) {
  if (entry.role !== el.dataset.role) return false;
  const t = normText(entry.text ?? "");
  if (!t || t.startsWith("[")) return true;
  return normText(el.textContent).includes(t.slice(0, 60));
}

async function entryIdForElement(el) {
  const entries = await fetchSessionEntries();
  const els = chatEls();
  const idx = els.indexOf(el);
  if (idx === -1 || !entries.length) return null;
  // same length -> zip by index; otherwise align from the end (the file can
  // briefly run ahead of / behind the rendered transcript while streaming)
  const pos = entries.length === els.length ? idx : entries.length - (els.length - idx);
  if (pos >= 0 && pos < entries.length && entryMatchesEl(entries[pos], el)) return entries[pos].id;
  const found = entries.find((e) => e.role === el.dataset.role && e.text && !e.text.startsWith("[")
    && normText(el.textContent).includes(normText(e.text).slice(0, 60)));
  return found?.id ?? (pos >= 0 && pos < entries.length ? entries[pos].id : null);
}

async function copyPermalink(el) {
  if (!state?.sessionId) { toast("no session id yet — send a message first", "warning"); return; }
  const eid = await entryIdForElement(el);
  if (!eid) { toast("could not identify this message in the session file", "warning"); return; }
  const url = `${location.origin}/s/${encodeURIComponent(state.sessionId)}/m/${encodeURIComponent(eid)}`;
  if (await copyText(url)) toast("permalink copied");
  else promptText("Permalink", "", url); // clipboard unavailable: show it instead
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    return ok;
  }
}

/** opening a /s/<sid>/m/<eid> permalink: scroll to / flash that message */
async function focusEntryById(entryId) {
  try {
    const entries = await fetchSessionEntries();
    const els = chatEls();
    const pos = entries.findIndex((e) => e.id === entryId);
    if (pos === -1) { toast("linked message not found in this session", "warning"); return; }
    const entry = entries[pos];
    let el = entries.length === els.length
      ? els[pos]
      : els[els.length - (entries.length - pos)] ?? null;
    if (!el || !entryMatchesEl(entry, el)) {
      const t = normText(entry.text ?? "");
      el = (t && !t.startsWith("[")
        ? els.find((x) => x.dataset.role === entry.role && normText(x.textContent).includes(t.slice(0, 60)))
        : null) ?? el;
    }
    if (!el) { toast("linked message not visible in transcript", "warning"); return; }
    flashEl(el);
  } catch (e) {
    toast(`permalink: ${e.message}`, "warning");
  }
}

// ------------------------------------------------------------ conversation tree

async function showConversationTree() {
  // pick which session to visualise: default to the current one
  const res = await fetch(`/sessions`);
  if (!res.ok) { toast(`failed to list sessions (${res.status})`, "error"); return; }
  const { sessions } = await res.json();
  if (!sessions.length) { toast("no saved sessions"); return; }
  const currentId = state?.sessionId;
  const session = sessions.find((s) => s.id === currentId) ?? sessions[0];
  await renderTreeModal(session, sessions);
}

async function renderTreeModal(session, sessions) {
  const res = await fetch(`/session-tree?path=${encodeURIComponent(session.path)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast(data.error || `failed to load tree (${res.status})`, "error"); return; }

  // build id -> children map; collapse runs of meta entries unless they branch
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const children = new Map();
  const roots = [];
  for (const n of data.nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      if (!children.has(n.parentId)) children.set(n.parentId, []);
      children.get(n.parentId).push(n);
    } else {
      roots.push(n);
    }
  }

  const showMeta = localStorage.getItem("pi_tree_meta") === "1";

  function nodeEl(n, isBranch) {
    const el = document.createElement("span");
    const role = n.type === "message" ? (n.role ?? "message") : "meta";
    el.className = `t-node ${role}` + (isBranch ? " branch" : "");
    const badge = document.createElement("span");
    badge.className = "t-badge";
    badge.textContent = role === "meta" ? "⚙" : role === "user" ? "you" : role === "assistant" ? "ai" : role;
    const label = document.createElement("span");
    label.className = "t-label";
    label.textContent = n.label || "(empty)";
    el.title = (n.label || "") + (n.timestamp ? `\n${n.timestamp}` : "");
    const time = document.createElement("span");
    time.className = "t-time";
    time.textContent = n.timestamp ? fmtSessionDate(n.timestamp) : "";
    el.append(badge, label, time);
    return el;
  }

  function renderList(nodes) {
    const ul = document.createElement("ul");
    for (let n of nodes) {
      const li = document.createElement("li");
      // collapse linear chains of hidden meta nodes
      let kids = children.get(n.id) ?? [];
      while (!showMeta && n.type !== "message" && kids.length === 1) {
        n = kids[0];
        kids = children.get(n.id) ?? [];
      }
      if (!showMeta && n.type !== "message" && kids.length === 0) continue;
      const isBranch = kids.length > 1;
      li.appendChild(nodeEl(n, isBranch));
      if (kids.length) li.appendChild(renderList(kids));
      ul.appendChild(li);
    }
    return ul;
  }

  const treeTitle = `Tree: ${session.name || session.preview || session.id?.slice(0, 8) || "session"}`;
  updateModal({ title: treeTitle });
  const body = $("mBody");
  body.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "tree";
  const tree = renderList(roots);
  if (!tree.children.length) {
    const empty = document.createElement("div");
    empty.className = "m-path";
    empty.textContent = "(no messages in this session)";
    wrap.appendChild(empty);
  } else {
    wrap.appendChild(tree);
  }
  body.appendChild(wrap);

  const actions = $("mActions");
  actions.innerHTML = "";
  const metaToggle = document.createElement("span");
  metaToggle.className = "chip";
  metaToggle.textContent = showMeta ? "Hide meta" : "Show meta";
  metaToggle.addEventListener("click", () => {
    localStorage.setItem("pi_tree_meta", showMeta ? "0" : "1");
    renderTreeModal(session, sessions);
  });
  const other = document.createElement("span");
  other.className = "chip";
  other.textContent = "Other session…";
  other.addEventListener("click", async () => {
    const idx = await pickOption("Pick session", sessions.map((s) =>
      `${s.name || s.preview || "(empty)"} — ${fmtSessionDate(s.modifiedAt)}`));
    if (idx == null) return;
    renderTreeModal(sessions[idx], sessions);
  });
  const close = document.createElement("button");
  close.className = "btn";
  close.textContent = "Close";
  close.style.padding = "6px 16px";
  close.addEventListener("click", closeModal);
  actions.append(metaToggle, other, close);
  openModal({ title: treeTitle, wide: true });
}

// ------------------------------------------------------------ modal helpers

const overlay = $("overlay");

function closeModal() {
  closeModalState();
  $("mBody").innerHTML = "";
  $("mActions").innerHTML = "";
}

setSettingsHandlers({ reload: () => reloadTranscript().catch(() => {}) });

/** Settings modal — rendered by Svelte; legacy only opens the modal shell. */
async function showSettingsModal() {
  $("mBody").innerHTML = "";
  $("mActions").innerHTML = "";
  openModal({ title: "Settings", content: "settings" });
}

function pickOption(title, options, { searchable = false } = {}) {
  $("mBody").innerHTML = "";
  $("mActions").innerHTML = "";
  return openOptionPicker(title, options, { searchable });
}

function promptText(title, placeholder, prefill) {
  $("mBody").innerHTML = "";
  $("mActions").innerHTML = "";
  return openTextPrompt(title, placeholder, prefill);
}

function confirmDialog(title, message) {
  $("mBody").innerHTML = "";
  $("mActions").innerHTML = "";
  return openConfirmPrompt(title, message);
}

// ------------------------------------------------------------ extension UI bridge

async function handleExtensionUI(req) {
  const respond = (payload) =>
    rpc({ type: "extension_ui_response", id: req.id, ...payload }, { wait: false }).catch(() => {});
  switch (req.method) {
    case "notify":
      toast(req.message, req.notifyType);
      return;
    case "confirm": {
      const ok = await confirmDialog(req.title, req.message);
      respond({ confirmed: ok });
      return;
    }
    case "select": {
      const idx = await pickOption(req.title, req.options);
      if (idx == null) respond({ cancelled: true });
      else respond({ value: req.options[idx] });
      return;
    }
    case "input": {
      const v = await promptText(req.title, req.placeholder);
      if (v == null) respond({ cancelled: true });
      else respond({ value: v });
      return;
    }
    case "editor": {
      const v = await promptText(req.title, "", req.prefill);
      if (v == null) respond({ cancelled: true });
      else respond({ value: v });
      return;
    }
    case "setTitle":
      updateHeaderState({ sessionTitle: req.title });
      return;
    default:
      return; // setStatus / setWidget / set_editor_text: no-op in web UI
  }
}

// ------------------------------------------------------------ toasts

function toast(text, kind, { onClick, sticky } = {}) {
  addToast(text, kind, { onClick, sticky });
}

// ------------------------------------------------------------ swipe carousel
//
// Mobile-only: horizontal swipes move through three views — chat, hublots,
// checkpoints — like snapping pages. A two-finger swipe switches between
// active sessions. A three-dot indicator at the bottom shows position.
//
// Pages: 0 = chat (no sidebar); 1 = hublots drawer; 2 = checkpoints drawer.
// Right swipe advances, left swipe goes back.

const CAROUSEL_PAGES = [
  { /* 0 — chat */ },
  { /* 1 — hublots */ sidebar: "hublots", load: () => { loadHublots(); loadRoutines(); } },
  { /* 2 — checkpoints */ sidebar: "treebar", load: () => loadCheckpointTree() },
];

let carousel = parseInt(localStorage.getItem("pi_carousel") || "0", 10);

function applyCarousel() {
  const onMobile = window.matchMedia("(max-width: 760px)").matches;
  const hublots = $("hublots");
  const treebar = $("treebar");
  if (!onMobile) {
    // desktop: reset to chat, let the docked sidebars show on their own
    hublots.classList.remove("open");
    treebar.classList.remove("open");
    carousel = 0;
    setCarouselDots();
    return;
  }
  const page = Math.max(0, Math.min(CAROUSEL_PAGES.length - 1, carousel));
  const wantHublots = page >= 1;
  const wantTree = page >= 2;
  if (wantHublots) hublots.classList.add("open"); else hublots.classList.remove("open");
  if (wantTree) treebar.classList.add("open"); else treebar.classList.remove("open");
  CAROUSEL_PAGES[page]?.load?.();
  setCarouselDots();
}

function setCarouselDots() {
  setCarouselPage(carousel);
}

// turn page via swipe; dir = +1 (right) or -1 (left)
function carouselStep(dir) {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  const next = Math.max(0, Math.min(CAROUSEL_PAGES.length - 1, carousel + dir));
  if (next === carousel) return;
  carousel = next;
  localStorage.setItem("pi_carousel", String(carousel));
  applyCarousel();
}

// ---- touch tracking ----
// We listen for horizontal one-finger swipes and two-finger swipes.
// Vertical scrolling, pinch-zoom and the composer textarea are left alone.
let touchStart = null; // { x, y, t, n }
let swipeHandled = false;

function swipeAxis(dx, dy) {
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return null;
  return Math.abs(dx) > Math.abs(dy) ? "h" : "v";
}

function onTouchStart(e) {
  if (window.matchMedia("(min-width: 761px)").matches) return; // desktop only
  // let inputs/textareas behave normally — but still capture finger count
  if (e.target.closest && e.target.closest("textarea, input, select")) return;
  if (e.target.closest && e.target.closest(".toast, #modal, #cmdPalette, #menu")) return;
  touchStart = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY,
    t: Date.now(),
    n: e.touches.length,
  };
  swipeHandled = false;
}

function onTouchMove(e) {
  if (!touchStart || swipeHandled) return;
  const dx = e.touches[0].clientX - touchStart.x;
  const dy = e.touches[0].clientY - touchStart.y;
  // once the gesture is clearly horizontal, claim it — stops the drawer's
  // overflow-y scroller from eating the swipe on iOS
  if (swipeAxis(dx, dy) === "h" && Math.abs(dx) > 12) {
    e.preventDefault();
  }
}

function onTouchEnd(e) {
  if (!touchStart || swipeHandled) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const dt = Date.now() - touchStart.t;
  const speed = Math.abs(dx) / Math.max(1, dt); // px/ms
  const axis = swipeAxis(dx, dy);

  if (axis !== "h") { touchStart = null; return; }

  // Need enough distance OR high speed on a quick flick
  const isSwipe = Math.abs(dx) > 60 || (speed > 0.4 && Math.abs(dx) > 30);
  if (!isSwipe) { touchStart = null; return; }

  swipeHandled = true;

  if (touchStart.n >= 2) {
    // two-finger horizontal swipe → switch active session
    switchToAdjacentRunner(dx < 0 ? 1 : -1);
    touchStart = null;
    return;
  }

  // one-finger swipe
  // swiping LEFT from page 0 opens hublots; left again opens checkpoints.
  // swiping RIGHT reverses: checkpoints → hublots → chat.
  carouselStep(dx < 0 ? 1 : -1);
  touchStart = null;
}

function onTouchCancel() {
  touchStart = null;
  swipeHandled = false;
}

// Find sessions the user would consider "active": alive, has a real
// session bound (sessionId + sessionName), and lives in the current
// workdir. Runners with sessionName === null were spawned but never sent
// a message to — they're background/orphan processes, skip them.
function switchToAdjacentRunner(dir) {
  const candidates = runnersNow.filter(
    (r) => r.alive && r.sessionId && r.sessionName && r.dir === workdir
  );
  if (candidates.length <= 1) {
    toast(candidates.length === 0 ? "no other active session" : "only one active session");
    return;
  }
  // stable ordering by server id (matches the /runners list order)
  const idx = alive.findIndex((r) => r.id === currentRunner);
  const base = idx === -1 ? 0 : idx;
  const next = (base + dir + alive.length) % alive.length;
  const target = alive[next];
  if (!target || target.id === currentRunner) return;
  switchToRunner(target.id);
}

function attachSwipeListeners() {
  if (window._piSwipeAttached) return;
  // capture phase: fires BEFORE the drawer's scroll container sees it, so
  // horizontal swipes over an open drawer aren't swallowed by overflow-y
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });
  window.addEventListener("resize", applyCarousel);
  window._piSwipeAttached = true;
}

// ---- unify the header chip taps with the carousel ----
function toggleHublotsFromHeader() {
  const hublots = $("hublots");
  if (window.matchMedia("(min-width: 761px)").matches) {
    // desktop: default toggle behaviour
    hublots.classList.toggle("open");
    if (hublots.classList.contains("open")) { loadHublots(); loadRoutines(); }
    return;
  }
  // mobile: carousel
  const opening = !hublots.classList.contains("open");
  carousel = opening ? 1 : 0;
  localStorage.setItem("pi_carousel", String(carousel));
  applyCarousel();
}

function toggleTreeFromHeader() {
  const treebar = $("treebar");
  if (window.matchMedia("(min-width: 761px)").matches) {
    treebar.classList.toggle("open");
    if (treebar.classList.contains("open")) loadCheckpointTree();
    return;
  }
  const opening = !treebar.classList.contains("open");
  carousel = opening ? 2 : 0;
  localStorage.setItem("pi_carousel", String(carousel));
  applyCarousel();
}

setHeaderHandlers({
  chooseModel,
  cycleThinking,
  openConfig: openConfigPicker,
  toggleHublots: toggleHublotsFromHeader,
  toggleTree: toggleTreeFromHeader,
});

// apply initial page on load + whenever the page becomes mobile/desktop
attachSwipeListeners();
applyCarousel();

// Backward-compatible globals for e2e/debug hooks. Inline scripts exposed
// top-level function declarations on window; ES modules intentionally do not.
Object.assign(window, { rpc, refreshState, loadHublots, loadRoutines });

// ------------------------------------------------------------ go

/** URL-driven boot: /s/<sessionId> attaches to that session's runner before
 *  the first SSE connect, so a reload (or a shared link) always lands on the
 *  same session; /m/<entryId> then focuses the linked message. */
async function boot() {
  if (route.sessionId) {
    try {
      const res = await fetch(`/session-by-id?id=${encodeURIComponent(route.sessionId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `lookup failed (${res.status})`);
      const r = await openSessionRunner({ sessionPath: data.session.path, dir: data.session.cwd || null });
      setRunner(r.id);
      if (route.messageId) {
        const mid = route.messageId;
        afterTranscript = () => focusEntryById(mid);
      }
    } catch (e) {
      toast(`could not open linked session: ${e.message}`, "warning");
    }
  }
  connect();
}

if (!token) requireToken();
else boot();
