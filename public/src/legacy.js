"use strict";

import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { createAuthProbe, initializeAuth, installAuthenticatedFetch } from "./runtime/authClient.js";
import { createRpcClient } from "./runtime/rpcClient.js";
import { createSseDeduper } from "./runtime/eventStreamUtils.js";
import { handleReplayDone, handleRunnerPing } from "./runtime/eventControllers.js";
import { createConnectionStateTransitions, createEventStreamRuntime, processEventMessage, runCanonicalReload, runReconnectWatchdog } from "./runtime/eventStream.js";
import { setCarouselPage } from "./stores/carousel.js";
import { updateAppSession } from "./stores/appSession.js";
import { openCheckpointModelPicker, updateCheckpointModelOptions } from "./stores/checkpointModelPicker.js";
import { setCheckpointBusy, setCheckpointTarget } from "./stores/checkpointMarker.js";
import { setCheckpointRestoreBusy, setCheckpointRestores } from "./stores/checkpointRestores.js";
import { setCheckpointTreeState } from "./stores/checkpointTree.js";
import { setCommandPaletteState, closeCommandPaletteState } from "./stores/commandPalette.js";
import { fileExplorer, updateFileExplorer } from "./stores/fileExplorer.js";
import { filePicker, updateFilePicker } from "./stores/filePicker.js";
import { folderBrowser, updateFolderBrowser } from "./stores/folderBrowser.js";
import { setComposerTextValue } from "./stores/composer.js";
import { updateHeaderState } from "./stores/header.js";
import { updateHublotManager } from "./stores/hublotManager.js";
import { hublots, hublotsLoading } from "./stores/hublots.js";
import { openConfirmPrompt, openEditorPrompt, openTextPrompt } from "./stores/dialogs.js";
import { closeModalState, openModal, updateModal } from "./stores/modal.js";
import { openOptionPicker } from "./stores/optionPicker.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "./stores/routines.js";
import { sessionPicker, updateSessionPicker } from "./stores/sessionPicker.js";
import { addToast } from "./stores/toasts.js";
import { messageEntryMatchesElement, shouldShowThinking, toolResultText, userMessageText } from "./lib/messageUtils.js";
import { splitTurns, takeTailChunk } from "./lib/transcriptUtils.js";
import { backfillTranscriptTurns } from "./lib/transcriptBackfill.js";
import { createTranscriptActions } from "./lib/transcriptActions.js";
import { applySessionState, fetchSessionPreview, openSession, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner } from "./lib/sessionActions.js";
import { loadCanonicalTranscript } from "./lib/transcriptReloadActions.js";
import { createCheckpoint, rollbackCheckpoint } from "./lib/checkpointActions.js";
import { createHublot, listHublots, refreshHublotScope } from "./lib/hublotActions.js";
import { listRoutines, runRoutine } from "./lib/routineActions.js";
import { browseFiles, readFile, saveFile, uploadFileChunk } from "./lib/fileBrowserActions.js";
import { resetTranscriptItems } from "./stores/transcriptItems.js";

/*
 * Ownership boundary during the orchestration migration:
 * - This module owns RPC/SSE transport, runner/session bootstrap, and the
 *   remaining document-level scroll and keyboard timing.
 * - Svelte stores and components own visible state and rendering. Transcript
 *   item construction, streaming state updates, and backfill scheduling live
 *   in transcript action modules.
 * - Feature workflows (checkpoints, hublots, routines, and file browsers) are
 *   still orchestrated here, but are extraction candidates for focused action
 *   modules.
 * - Components dispatch narrow custom events only for actions that still
 *   require legacy-owned transport or session lifecycle coordination.
 */

const lifecycleStartedAt = performance.now();
function lifecycleLog(label, data = {}) {
  const elapsed = Math.round(performance.now() - lifecycleStartedAt);
  console.log(`[pi-ui lifecycle +${elapsed}ms] ${label}`, {
    runner: currentRunner,
    sessionId: state?.sessionId ?? null,
    replaying,
    transcriptGateRequired,
    replayDoneSeen,
    connected,
    ...data,
  });
}

// ------------------------------------------------------------ token

// Auth/token initialization is runtime-owned; legacy receives its current
// token for transport and EventSource construction.
const token = initializeAuth();
installAuthenticatedFetch(token);

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
const probeTokenValidity = createAuthProbe({
  getToken: () => token,
  onUnauthorized: () => {
    localStorage.removeItem("pi_ui_token");
    document.cookie = "pi_ui_token=; path=/; max-age=0";
    updateHeaderState({ stateInfo: "invalid token" });
    requireToken();
  },
});

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

const rpcClient = createRpcClient({
  getRunner: () => currentRunner,
  getToken: () => token,
  onUnauthorized: handleUnauthorized,
  onPendingResume: () => toast("session is still resuming — message queued", "warning"),
});
const { rpc, handleResponse } = rpcClient;

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

const toolCards = new Map(); // toolCallId -> {store}

function ensureToolCardStore(tc) {
  let card = toolCards.get(tc.id);
  if (!card) {
    card = { store: writable({ toolCall: tc, status: "running", resultText: "" }) };
    toolCards.set(tc.id, card);
  } else {
    card.store.update((state) => ({ ...state, toolCall: tc }));
  }
  return card.store;
}

function finishToolCard(toolCallId, resultMsgOrText, isError) {
  const card = toolCards.get(toolCallId);
  if (!card) return;
  const text = typeof resultMsgOrText === "string" ? resultMsgOrText : toolResultText(resultMsgOrText);
  card.store.update((state) => ({
    ...state,
    status: isError ? "error" : "ok",
    resultText: text,
  }));
}

let liveAssistant = null; // { item, msg }

const transcriptCallbacks = {
  onPermalink: (el) => copyPermalink(el).catch((err) => toast(`permalink failed: ${err.message}`, "error")),
  onCheckpoint: handleCheckpointClick,
  onRollback: rollbackToCheckpoint,
};

const transcriptActions = createTranscriptActions({
  callbacks: transcriptCallbacks,
  renderMarkdown,
  shouldShowThinking,
  storage: localStorage,
  ensureToolCardStore,
});

function assistantAlreadyRendered(message) {
  const text = transcriptActions.assistantPlainText(message);
  if (!text) return false;
  const needle = text.slice(0, 120);
  return [...messagesEl.querySelectorAll('.msg.assistant')].some((el) =>
    el.textContent.replace(/\s+/g, " ").includes(needle)
  );
}

function mountSvelteAssistantMessage(message, role = "assistant", options = {}) {
  return transcriptActions.addAssistant(message, role, options);
}

function updateSvelteAssistant(live, message) {
  transcriptActions.updateAssistant(live, message);
}

function addSvelteAssistantMessage(message, role = "assistant", options = {}) {
  mountSvelteAssistantMessage(message, role, options);
  if (role === "assistant") placeCheckpointBtn();
}

function addSvelteCustomMessage(role, text) {
  addSvelteAssistantMessage({ role, content: [{ type: "text", text }] }, role || "custom");
}

function addUserMessage(message, options = {}) {
  const text = userMessageText(message);
  transcriptActions.addUser(text, options);
  if (/^Opening interface: /.test(text)) {
    scrollToBottom(true);
    return;
  }
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

// ------------------------------------------------------------ checkpoints
//
// The iceberg on the LATEST message commits every pending change in the
// runner's workdir (server-side `git add -A && git commit`), freezing the
// state the conversation reached at that point.

let checkpointBusy = false;
/** Modal with a single model selector for the diff-summary sub-agent; the
 *  choice is remembered (localStorage) and preselected next time.
 *  Resolves { model } (null model = no summary) or { cancelled: true }. */
function pickCheckpointModel({
  title = "Freeze checkpoint",
  hint = "The model summarizes the diff into the commit message. Your choice is remembered.",
  okLabel = "Freeze \u{1F9CA}",
} = {}) {
  const picker = openCheckpointModelPicker({ title, hint, okLabel, loading: true });
  rpc({ type: "get_available_models" }).then(({ models }) => {
    updateCheckpointModelOptions(models.map((m) => `${m.provider}/${m.id}`));
  }).catch(() => updateCheckpointModelOptions([]));
  return picker;
}

async function handleCheckpointClick(e) {
  e.stopPropagation();
  if (checkpointBusy) return;
  const pick = await pickCheckpointModel();
  if (pick.cancelled) return; // no checkpoint
  const model = pick.model;
  checkpointBusy = true;
  setCheckpointBusy(true);
  if (model) toast(`\u{1F9CA} summarizing diff with ${model}…`);
  try {
    const data = await createCheckpoint(fetch, currentRunner, model);
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
    checkpointBusy = false;
    setCheckpointBusy(false);
  }
}

/** keep the Svelte-owned iceberg on the latest user/assistant message */
function placeCheckpointBtn() {
  // Store updates render on Svelte's next flush, so wait before querying the
  // preserved DOM selectors used by checkpoint alignment.
  void tick().then(() => {
    const els = chatEls();
    setCheckpointTarget(els[els.length - 1] ?? null);
  });
}

/** put a return arrow on every message a checkpoint is anchored to */
async function refreshCheckpointMarkers() {
  setCheckpointRestores([]);
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
  const restores = [];
  for (let i = 0; i < entries.length; i++) {
    const cp = { ...byAnchor.get(entries[i].id), sessionId: sid };
    if (!cp.hash) continue;
    // Same zip-by-position logic as the permalinks (align from the end when
    // the file and rendered transcript briefly disagree).
    const pos = entries.length === els.length ? i : els.length - (entries.length - i);
    const target = els[pos];
    if (target) restores.push({ target, checkpoint: cp, busy: false });
  }
  setCheckpointRestores(restores);
}

/** deterministic rollback: restore the checkpoint commit (pending changes are
 *  auto-committed first) and jump into a session forked at that point */
async function rollbackToCheckpoint(cp, target = null) {
  // same modal as freeze: the model summarizes the pending changes that get
  // auto-committed before the reset (the modal doubles as confirmation)
  const pick = await pickCheckpointModel({
    title: `Roll back to ${cp.hash}`,
    hint: "Pending changes are committed first (nothing is lost) — the model summarizes them into that commit's message — then the workdir is reset and a forked session opens at this message.",
    okLabel: "Roll back \u23EA",
  });
  if (pick.cancelled) return;
  if (target) setCheckpointRestoreBusy(target, true);
  try {
    const data = await rollbackCheckpoint(fetch, { sessionId: cp.sessionId ?? state?.sessionId, hash: cp.hash, model: pick.model });
    toast(`\u23EA rolled back to ${data.rolledBack}${data.safety ? ` (pending work saved as ${data.safety})` : ""} — forked session opened`);
    if (data.runner?.id) switchToRunner(data.runner.id);
  } catch (err) {
    toast(`rollback failed: ${err.message}`, "error");
  } finally {
    if (target) setCheckpointRestoreBusy(target, false);
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

window.addEventListener("pi-checkpoint-tree-open-session", (event) => openTreeSession(event.detail));
window.addEventListener("pi-checkpoint-tree-rollback", (event) => rollbackToCheckpoint(event.detail.checkpoint, event.detail.target));

function renderFullMessage(message, options = {}) {
  const role = message.role;
  if (role === "user") { addUserMessage(message, options); return; }
  if (role === "assistant") { addSvelteAssistantMessage(message, role, options); return; }
  if (role === "toolResult") {
    if (toolCards.has(message.toolCallId)) {
      finishToolCard(message.toolCallId, message, message.isError);
    }
    return;
  }
  // custom messages (extensions etc.) — show generically if they carry text
  if (message.content) {
    const text = toolResultText(message);
    if (text) addSvelteAssistantMessage({ role: message.role, content: [{ type: "text", text }] }, message.role || "custom", options);
  }
}

function clearMessages() {
  renderJob++; // cancel any in-flight transcript backfill
  setCheckpointTarget(null);
  setCheckpointRestores([]);
  resetTranscriptItems();
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

function renderChunk(chunk, { prepend = false } = {}) {
  backfilling = true;
  try {
    // Prepending individual items reverses their order, so consume older
    // chunks backwards to retain chronological transcript order.
    const messages = prepend ? [...chunk].reverse() : chunk;
    for (const m of messages) renderFullMessage(m, { prepend });
  } finally { backfilling = false; }
}

/** Render `messages`; resolves true when the FULL transcript is in the DOM
 *  (false if superseded by a newer render). */
async function renderTranscript(messages) {
  lifecycleLog("renderTranscript:start", { messages: messages?.length ?? 0 });
  clearMessages(); // also bumps renderJob, cancelling any older backfill
  const myJob = ++renderJob;
  // ↑/↓ prompt recall must stay chronological even though rendering is
  // tail-first: prefill it from the full list (same skip rule as addUserMessage)
  for (const m of messages) {
    if (m.role !== "user") continue;
    const t = userMessageText(m);
    if (t && !/^Opening interface: /.test(t)) rememberPrompt(t);
  }
  const turns = splitTurns(messages);
  const tail = takeTailChunk(turns, TAIL_MSGS);
  renderChunk(tail);
  await tick();
  scrollToBottom(true);

  const complete = await backfillTranscriptTurns({
    turns,
    takeTailChunk,
    chunkSize: CHUNK_MSGS,
    isCurrent: () => myJob === renderJob,
    beforePrepend: () => ({
      pinned: nearBottom(),
      height: scroller.scrollHeight,
      top: scroller.scrollTop,
    }),
    renderPrepend: async (chunk) => {
      renderChunk(chunk, { prepend: true });
      await tick();
    },
    afterPrepend: ({ pinned, height, top }) => {
      if (pinned) scrollToBottom(true); // stay glued to the newest message
      else scroller.scrollTop = top + (scroller.scrollHeight - height); // keep reading position
    },
  });
  if (!complete) {
    lifecycleLog("renderTranscript:superseded", { job: myJob, activeJob: renderJob });
    return false;
  }
  placeCheckpointBtn();
  lifecycleLog("renderTranscript:complete", { job: myJob, domMessages: messagesEl.children.length });
  return true;
}

// ------------------------------------------------------------ state / header

let state = null;

function fmtCost(n) { return n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0"; }

function applyState(s) {
  const result = applySessionState({ incoming: s, previousState: state, currentRunner, emptySessionRunners, routinesNow, routineVisible, tunnelScopeAll, hooks: {
    log: (sessionChanged) => lifecycleLog("applyState", { incomingSessionId: s?.sessionId ?? null, previousSessionId: state?.sessionId ?? null, sessionChanged, messageCount: s?.messageCount ?? null, pendingMessageCount: s?.pendingMessageCount ?? null, isStreaming: !!s?.isStreaming, isCompacting: !!s?.isCompacting, model: s?.model?.id ?? null, sessionFile: s?.sessionFile ?? null }),
    setState: (next) => { state = next; }, updateAppSession, setTranscriptGateRequired,
    setRoutines: routines.set, setRoutineScopeAll: routineScopeAll.set, setRoutineCurrentSessionId: routineCurrentSessionId.set,
    loadHublots, loadRoutines, syncUrlToSession, updateHeaderState, setBusy,
  } });
  state = result.state;
}

let workdir = null;

// ------------------------------------------------------------ runners
// The server keeps one pi process ("runner") per open session; this client
// is attached to exactly one at a time. Other runners keep working in the
// background.

let currentRunner = readPersistedRunner(localStorage);
let runnersNow = []; // latest known runner list (for session indicators)
updateAppSession({ currentRunner, runners: runnersNow });
/** one-shot callback run after the next transcript reload (e.g. focus a search hit) */
let afterTranscript = null;

function setRunner(id) {
  currentRunner = id || null;
  updateAppSession({ currentRunner });
  persistRunner(localStorage, id);
}

function setRunnersNow(runners) {
  runnersNow = runners ?? [];
  updateAppSession({ runners: runnersNow });
}

/** attach this client to another runner and rebuild the UI from its stream */
function switchToRunner(id) {
  switchSessionRunner({ id, currentRunner, hooks: {
    log: (details) => lifecycleLog("switchToRunner:start", details),
    resetPreview: () => { lastPreview = null; },
    refreshState,
    setRunner,
    clearTranscript: clearMessages,
    resetSessionUi: () => {
      // The new session has its own tree; do not leave stale sidebars visible.
      if (carousel !== 0) { carousel = 0; localStorage.setItem("pi_carousel", "0"); }
      $("hublots").classList.remove("open");
      $("treebar").classList.remove("open");
      setCarouselDots();
    },
    renderPreview: renderPreviewNow,
    resetCommands: () => { knownCommands = null; },
    connect,
  } });
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
  lifecycleLog("preview:render", { sessionPath: lastPreview.sessionPath, messages: lastPreview.messages.length });
  // no checkpoint markers here: `state` still describes the previous session
  // until get_state answers; the canonical reload adds them right after
  renderTranscript(lastPreview.messages);
}

async function fetchPreview(sessionPath) {
  const started = performance.now();
  lifecycleLog("preview:fetch:start", { sessionPath });
  try {
    const messages = await fetchSessionPreview(fetch, sessionPath);
    if (messages === null) {
      lifecycleLog("preview:fetch:not-ok", { sessionPath, ms: Math.round(performance.now() - started) });
      return;
    }
    lifecycleLog("preview:fetch:done", { sessionPath, messages: messages.length, ms: Math.round(performance.now() - started), superseded: lastPreview?.sessionPath !== sessionPath });
    if (lastPreview?.sessionPath !== sessionPath) return; // superseded meanwhile
    lastPreview.messages = messages;
    renderPreviewNow();
  } catch (e) {
    lifecycleLog("preview:fetch:error", { sessionPath, error: e?.message ?? String(e), ms: Math.round(performance.now() - started) });
  }
}

/** get-or-spawn a runner for a session file / folder */
async function openSessionRunner({ sessionPath = null, dir = null } = {}) {
  const started = performance.now();
  lifecycleLog("openSessionRunner:start", { sessionPath, dir });
  // kick off the file-based transcript preview in parallel — unless the
  // target session is the one already on screen (don't clobber live state)
  const cur = runnersNow.find((r) => r.id === currentRunner);
  if (sessionPath && sessionPath !== cur?.sessionFile) {
    lastPreview = { sessionPath, messages: null };
    fetchPreview(sessionPath);
  }
  const runner = await openSession(fetch, { sessionPath, dir });
  if (!sessionPath && runner?.id) emptySessionRunners.add(runner.id);
  lifecycleLog("openSessionRunner:done", { runner: runner?.id, sessionPath: runner?.sessionFile, sessionId: runner?.sessionId, ms: Math.round(performance.now() - started) });
  return runner;
}

/** hook: session picker (when open) re-renders its indicators */
let onRunnersUpdate = null;

function setWorkdir(dir) {
  workdir = dir;
  updateAppSession({ workdir });
}

let busy = false;
function setBusy(b) {
  busy = b;
  updateAppSession({ busy });
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
const eventStream = createEventStreamRuntime();
const connectionState = createConnectionStateTransitions({
  setConnected: (value) => { connected = value; updateAppSession({ connected }); },
  setStatus: (stateInfo) => updateHeaderState({ stateInfo }),
});

// Watchdog: the server sends a ping event every 25s. Through a tunnel, a
// connection can die without the browser noticing (EventSource stays OPEN
// forever on a half-dead socket) — if nothing arrives for 70s, force a
// reconnect.
let lastEventAt = Date.now();
setInterval(() => {
  runReconnectWatchdog({
    source: es,
    lastEventAt,
    onExpired: () => {
      eventStream.close();
      connectionState.lost();
      connect();
    },
  });
}, 15000);

function connect({ replay = true } = {}) {
  if (!token) { requireToken(); return; }
  eventStream.close();
  const connectStarted = performance.now();
  lastEventAt = Date.now();
  const skipTranscriptGate = currentRunner && emptySessionRunners.has(currentRunner);
  setTranscriptGateRequired(!skipTranscriptGate);
  // Brand-new empty runners have no transcript to replay. Do not enter the
  // replay gate at all; otherwise a fast first response can be treated like
  // replay and dropped even though the composer is intentionally enabled.
  setReplaying(!skipTranscriptGate, skipTranscriptGate ? null : "replay");
  replayDoneSeen = false;
  replayBufferedEvents = [];
  const replayParam = replay ? "1" : "0";
  lifecycleLog("connect:start", { replay, skipTranscriptGate, replayParam });
  const eventHandlers = { onopen: async () => {
    lifecycleLog("connect:onopen", { replay, skipTranscriptGate, ms: Math.round(performance.now() - connectStarted) });
    connectionState.opened();
    lifecycleLog("connect:onopen:reloadTranscript:start");
    await runCanonicalReload({
      skipTranscriptGate,
      isReplaying: () => replaying,
      setReplaying,
      refreshState,
      reloadTranscript,
      onError: (e) => {
        lifecycleLog("connect:onopen:reloadTranscript:error", { error: e?.message ?? String(e), ms: Math.round(performance.now() - connectStarted) });
        if (!String(e.message).includes("unauthorized")) toast(`init failed: ${e.message}`, "error");
      },
    });
    lifecycleLog("connect:onopen:reloadTranscript:done", { ms: Math.round(performance.now() - connectStarted) });
  },
  onerror: () => {
    lifecycleLog("connect:onerror", { ms: Math.round(performance.now() - connectStarted) });
    connectionState.reconnecting();
    // EventSource can't see HTTP status codes, so a 401 (bad stored token)
    // looks identical to a network blip and would retry forever. Probe
    // /authcheck to tell them apart, at most once per 10s.
    probeTokenValidity();
  },
  onmessage: (ev) => processEventMessage(ev.data, {
    onReceived: () => { lastEventAt = Date.now(); },
    dedupe: isDuplicateSseEvent,
    dispatch: handleEvent,
    onError: (error, message) => console.error("event handling failed", error, message),
  }),
  };
  es = eventStream.connect({ token, runner: currentRunner, replay }, eventHandlers);
}

// True from (re)connect until the canonical transcript's tail is rendered.
// This covers BOTH the SSE replay buffer and the live events of a busy
// runner: rendering either before reloadTranscript() has rebuilt the
// transcript would paint duplicates onto the preview and fight its scroll
// position. reloadTranscript() lifts the gate the moment the tail is in the
// DOM (live events append below it just fine while history backfills above).
let replaying = true;
let replayDoneSeen = false;
let replayBufferedEvents = [];
let transcriptGateRequired = true;
const dedupeSseEvent = createSseDeduper();
const emptySessionRunners = new Set();
updateAppSession({ replayingTranscript: true, transcriptLoadPhase: "replay", transcriptGateRequired });
function setTranscriptGateRequired(value) {
  transcriptGateRequired = !!value;
  updateAppSession({ transcriptGateRequired });
}
function isDuplicateSseEvent(msg) {
  const duplicate = dedupeSseEvent(msg);
  if (duplicate) lifecycleLog("sse:duplicate", { type: msg?.type, sseId: msg?._sseId });
  return duplicate;
}
function composerReadyForSend() {
  return connected && (!replaying || !transcriptGateRequired);
}
function setReplaying(value, phase = null) {
  const next = !!value;
  if (replaying !== next || phase) lifecycleLog("setReplaying", { from: replaying, to: next, phase });
  replaying = next;
  updateAppSession({ replayingTranscript: replaying, transcriptLoadPhase: replaying ? phase : null });
}
const REPLAY_GATED_EVENTS = [
  "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "agent_start", "agent_end",
];

function flushReplayBufferedEvents(events) {
  lifecycleLog("replayBuffer:flush", { events: events.length, types: events.map((event) => event.type).slice(0, 20) });
  // If get_messages completed after the live assistant already finished, the
  // canonical render already contains that answer. In that case, dropping the
  // buffered assistant/tool sequence avoids painting a duplicate while still
  // preserving the normal in-progress case (no message_end yet) where buffered
  // deltas are the only copy the user can see without a refresh.
  const finishedAssistantAlreadyRendered = events.some((event) =>
    event.type === "message_end" && event.message?.role === "assistant" && assistantAlreadyRendered(event.message)
  );
  for (const event of events) {
    if (finishedAssistantAlreadyRendered && (
      ["message_start", "message_update", "message_end"].includes(event.type) && event.message?.role === "assistant" ||
      ["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)
    )) continue;
    handleEvent(event);
  }
}

function handleEvent(msg) {
  if (["replay_done", "agent_start", "agent_end", "message_start", "message_end", "response", "runner_unhealthy", "pi_started", "pi_exit"].includes(msg.type)) {
    lifecycleLog("sse:event", { type: msg.type, command: msg.command, sseId: msg._sseId, role: msg.message?.role, runner: msg.runner });
  }
  // While the SSE replay buffer is being re-delivered, ignore old transcript-
  // rendering events: reloadTranscript() rebuilds the canonical state, so
  // rendering replayed copies would duplicate messages/tool cards. Once the
  // server has sent replay_done, any further events are live events that can
  // arrive while reloadTranscript() is still awaiting get_state/get_messages;
  // buffer those and flush them after the canonical tail is on screen. Without
  // this, a response that finishes during reconnect can be dropped until the
  // user refreshes the page.
  if (replaying && transcriptGateRequired && REPLAY_GATED_EVENTS.includes(msg.type)) {
    lifecycleLog("sse:gated", { type: msg.type, role: msg.message?.role, replayDoneSeen, buffered: replayBufferedEvents.length });
    if (replayDoneSeen) replayBufferedEvents.push(msg);
    return;
  }
  switch (msg.type) {
    case "ping":
      // Pings carry authoritative runner liveness, handled by the runtime
      // controller while legacy supplies store/tree adapters.
      handleRunnerPing(msg, {
        currentRunners: () => runnersNow,
        setRunners: setRunnersNow,
        onRunnersChanged: (runners) => onRunnersUpdate?.(runners),
        refreshTree: refreshTreeIfOpen,
      });
      return;

    case "replay_done":
      // The canonical transcript render, not this event, opens the live gate.
      handleReplayDone(msg, {
        markReplayDone: () => { replayDoneSeen = true; },
        isReplaying: () => replaying,
        setReplaying,
        setRunner,
        setRunners: setRunnersNow,
        setWorkdir,
        refreshHublots: loadHublots,
        refreshRoutines: loadRoutines,
      });
      return;

    case "runners_update":
      setRunnersNow(msg.runners ?? []);
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
      // Belt-and-suspenders consistency check: if any message delta/end was
      // missed by EventSource or by the reconnect replay gate, the canonical
      // transcript still has the final assistant turn. Sync shortly after the
      // run finishes so the user does not need to refresh to see the answer.
      schedulePostAgentTranscriptSync();
      return;

    case "message_start": {
      const m = msg.message;
      if (m.role === "assistant") {
        liveAssistant = mountSvelteAssistantMessage(m);
        scrollToBottom(true);
      } else if (m.role === "user") {
        const idx = localEchoes.indexOf(userMessageText(m));
        if (idx !== -1) localEchoes.splice(idx, 1); // already rendered on send
        else addUserMessage(m);
      }
      return;
    }

    case "message_update": {
      const m = msg.message;
      if (m.role === "assistant") {
        if (!liveAssistant) liveAssistant = mountSvelteAssistantMessage(m);
        updateSvelteAssistant(liveAssistant, m);
        scrollToBottom(false);
      }
      return;
    }

    case "message_end": {
      const m = msg.message;
      if (m.role === "assistant") {
        if (liveAssistant) updateSvelteAssistant(liveAssistant, m);
        else addSvelteAssistantMessage(m);
        liveAssistant = null;
        updateUsage(m);
      } else if (m.role === "toolResult") {
        finishToolCard(m.toolCallId, m, m.isError);
      }
      scrollToBottom(false);
      return;
    }

    case "tool_execution_start": {
      const card = toolCards.get(msg.toolCallId);
      if (card) card.store.update((state) => ({ ...state, status: "running" }));
      return;
    }

    case "tool_execution_update": {
      const card = toolCards.get(msg.toolCallId);
      if (card && msg.partialResult) {
        const text = typeof msg.partialResult === "string"
          ? msg.partialResult
          : toolResultText(msg.partialResult) || JSON.stringify(msg.partialResult);
        card.store.update((state) => ({ ...state, resultText: text.slice(-20000) }));
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
  const started = performance.now();
  lifecycleLog("reloadTranscript:start");
  // Kick off both requests in parallel, but apply get_state as soon as it is
  // available. Existing sessions can have a slow transcript replay/resume;
  // the header/composer/session-scoped sidebars should still converge without
  // waiting for the full message list to render.
  const { messages } = await loadCanonicalTranscript({
    getState: () => rpc({ type: "get_state" }),
    getMessages: () => rpc({ type: "get_messages" }),
    applyState,
    onState: (s) => lifecycleLog("reloadTranscript:get_state:done", { ms: Math.round(performance.now() - started), messageCount: s?.messageCount ?? null, sessionFile: s?.sessionFile ?? null }),
    onMessages: (result) => lifecycleLog("reloadTranscript:get_messages:done", { ms: Math.round(performance.now() - started), messages: result?.messages?.length ?? 0 }),
    getDurableMessages: async (s) => {
      const res = await fetch(`/session-messages?${sessionFileQuery(s.sessionFile)}`);
      if (!res.ok) throw new Error(`session-messages failed (${res.status})`);
      return res.json();
    },
    onDurableMessages: (result) => lifecycleLog("reloadTranscript:session-messages:done", { ms: Math.round(performance.now() - started), messages: result?.messages?.length ?? 0 }),
  });
  lastPreview = null; // canonical content from pi supersedes the file preview
  const rendered = renderTranscript(messages); // tail is in the DOM after this call
  lifecycleLog("reloadTranscript:tail-rendered", { ms: Math.round(performance.now() - started), messages: messages.length });
  // the transcript now shows the right last messages: let live events through
  // (they append below the tail; backfill continues above the viewport)
  setReplaying(false);
  const buffered = replayBufferedEvents;
  replayBufferedEvents = [];
  flushReplayBufferedEvents(buffered);
  const complete = await rendered;
  lifecycleLog("reloadTranscript:render-complete", { complete, ms: Math.round(performance.now() - started) });
  // markers and the permalink-focus callback need the FULL transcript in the
  // DOM (their targets may live in a backfilled chunk); skip both if this
  // render was superseded by a newer one meanwhile
  if (!complete) return;
  annotateTranscriptEntries().catch(() => {});
  refreshCheckpointMarkers().catch(() => {});
  refreshTreeIfOpen();
  const cb = afterTranscript;
  afterTranscript = null;
  cb?.();
}

let postAgentTranscriptSyncTimer = null;
let postSendFileSyncTimer = null;
function syncTranscriptSoon(label, delay = 250) {
  return setTimeout(() => {
    if (replaying || !currentRunner) {
      syncTranscriptSoon(label, 500);
      return;
    }
    reloadTranscript().catch((e) => {
      if (!String(e.message).includes("unauthorized")) console.warn(`${label} transcript sync failed`, e);
    });
  }, delay);
}

function schedulePostAgentTranscriptSync() {
  clearTimeout(postAgentTranscriptSyncTimer);
  postAgentTranscriptSyncTimer = syncTranscriptSoon("post-agent", 250);
}

function schedulePostSendFileTranscriptSync(expectedUserText) {
  clearTimeout(postSendFileSyncTimer);
  const runnerId = currentRunner;
  let sessionFile = state?.sessionFile || null;
  const started = Date.now();
  const tick = async () => {
    try {
      if (!sessionFile && runnerId) {
        const runnersRes = await fetch(`/runners`);
        if (runnersRes.ok) {
          const runnersData = await runnersRes.json();
          sessionFile = (runnersData.runners ?? []).find((r) => r.id === runnerId)?.sessionFile || null;
        }
      }
      if (sessionFile && runnerId === currentRunner) {
        const res = await fetch(`/session-messages?${sessionFileQuery(sessionFile)}`);
        if (!res.ok && res.status >= 400 && res.status < 500) {
          lifecycleLog("postSendFileSync:session-messages:stop", { status: res.status, sessionFile });
          return;
        }
        if (res.ok) {
          const data = await res.json();
          const messages = Array.isArray(data.messages) ? data.messages : [];
          const sawUser = messages.some((m) => m.role === "user" && userMessageText(m) === expectedUserText);
          const sawAssistantAfterUser = sawUser && messages.some((m, i) =>
            m.role === "assistant" && messages.slice(0, i).some((prev) => prev.role === "user" && userMessageText(prev) === expectedUserText)
          );
          if (sawAssistantAfterUser) {
            renderTranscript(messages);
            return;
          }
        }
      }
    } catch {}
    if (Date.now() - started < 15000 && runnerId === currentRunner) postSendFileSyncTimer = setTimeout(tick, 750);
  };
  postSendFileSyncTimer = setTimeout(tick, 750);
}

let stateRefreshTimer = null;
function refreshState() {
  clearTimeout(stateRefreshTimer);
  lifecycleLog("refreshState:scheduled");
  stateRefreshTimer = setTimeout(async () => {
    const started = performance.now();
    lifecycleLog("refreshState:start");
    try {
      applyState(await rpc({ type: "get_state" }));
      lifecycleLog("refreshState:done", { ms: Math.round(performance.now() - started) });
    } catch (e) {
      lifecycleLog("refreshState:error", { error: e?.message ?? String(e), ms: Math.round(performance.now() - started) });
    }
  }, 150);
}

// ------------------------------------------------------------ composer

const input = $("input");

function composerInputChanged() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  setComposerTextValue(input.value);
  setBusy(busy); // refresh busy state UI
  histIdx = null; // typing exits history navigation
}

function setComposerText(text) {
  input.value = text;
  setComposerTextValue(text);
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
  if (!text || !composerReadyForSend()) return;
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
  setComposerTextValue("");
  input.style.height = "auto";
  setBusy(busy); // hide the Steer button again
  addUserMessage({ role: "user", content: text });
  localEchoes.push(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
    // Cloudflare/EventSource can occasionally stall live SSE delivery. Poll the
    // canonical session file with ordinary fetch as a bounded fallback so a
    // fast first response appears without a manual refresh.
    schedulePostSendFileTranscriptSync(text);
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

document.addEventListener("pi:composer", (event) => {
  const { action, sourceEvent } = event.detail ?? {};
  if (action === "inputChanged") composerInputChanged();
  else if (action === "keydown") composerKeydown(sourceEvent);
  else if (action === "send") send();
  else if (action === "abort") abort();
});

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

window.addEventListener("pi-command-palette-run", (event) => runCmdIndex(event.detail));

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
window.addEventListener("pi-menu-action", (event) => runMenuAction(event.detail));

// ------------------------------------------------------------ attach file

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
let filePickerState = {
  curDir: "",
  showHidden: true,
  onPick: insertIntoComposer,
  onCancel: null,
  returnToHublot: false,
};

function finishFilePicker() {
  closeModal();
  if (filePickerState.returnToHublot) showHublots().catch((e) => toast(e.message, "error"));
}

async function loadFilePicker(path) {
  updateFilePicker({ loading: true });
  let data;
  try { data = await browseFiles(fetch, path); }
  catch (error) {
    updateFilePicker({ loading: false });
    toast(error.message, "error");
    // e.g. remembered folder was deleted — fall back to the workdir
    if (path !== workdir) return loadFilePicker(workdir);
    return;
  }
  filePickerState.curDir = data.path;
  updateModal({ title: "Attach file" });
  updateFilePicker({
    path: data.path,
    home: data.home,
    workdir: data.workdir,
    parent: data.parent,
    dirs: data.dirs ?? [],
    files: data.files ?? [],
    showHidden: get(filePicker).showHidden,
    loading: false,
  });
}

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
async function showFilePicker(onPick = insertIntoComposer, onCancel = null, returnToHublot = false) {
  // always open in the current session's working directory
  filePickerState = {
    curDir: workdir,
    showHidden: true,
    onPick,
    onCancel,
    returnToHublot,
  };
  updateFilePicker({
    path: "",
    home: "",
    workdir: "",
    parent: null,
    dirs: [],
    files: [],
    showHidden: true,
    loading: true,
  });
  openModal({ title: "Attach file", content: "filePicker" });
  await loadFilePicker(filePickerState.curDir);
}

window.addEventListener("pi-file-picker-use-folder", () => {
  filePickerState.onPick?.(filePickerState.curDir);
  finishFilePicker();
});
window.addEventListener("pi-file-picker-browse", (event) => loadFilePicker(event.detail));
window.addEventListener("pi-file-picker-pick", (event) => {
  filePickerState.onPick?.(event.detail);
  finishFilePicker();
});
window.addEventListener("pi-file-picker-cancel", () => {
  filePickerState.onCancel?.();
  finishFilePicker();
});

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

let folderBrowserState = {
  browsePath: "",
  showHidden: true,
  done: null,
};

async function loadFolderBrowser(path) {
  updateFolderBrowser({ loading: true });
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/browse${q}`);
  const data = await res.json();
  if (!res.ok) {
    updateFolderBrowser({ loading: false });
    toast(data.error || "cannot open folder", "error");
    return;
  }
  folderBrowserState.browsePath = data.path;
  updateModal({ title: "New session in folder" });
  updateFolderBrowser({
    path: data.path,
    home: data.home,
    parent: data.parent,
    dirs: data.dirs ?? [],
    showHidden: get(folderBrowser).showHidden,
    loading: false,
  });
}

async function showFolderBrowser() {
  folderBrowserState = {
    browsePath: workdir,
    showHidden: true,
    done: null,
  };
  const finished = new Promise((resolve) => { folderBrowserState.done = resolve; });
  updateFolderBrowser({
    path: "",
    home: "",
    parent: null,
    dirs: [],
    showHidden: true,
    loading: true,
    creating: false,
    createOpen: false,
    newName: "",
  });
  openModal({ title: "New session in folder", content: "folderBrowser" });
  await loadFolderBrowser(folderBrowserState.browsePath);

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

const createFolderBrowser = async () => {
    let snapshot;
    const unsubscribe = folderBrowser.subscribe((s) => { snapshot = s; });
    unsubscribe();
    const name = (snapshot?.newName ?? "").trim();
    if (!name) return;
    updateFolderBrowser({ creating: true });
    try {
      const res = await fetch(`/mkdir`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: folderBrowserState.browsePath, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || `mkdir failed (${res.status})`, "error");
        updateFolderBrowser({ creating: false });
        return;
      }
      toast(`created ${data.path}`);
      updateFolderBrowser({ creating: false, createOpen: false, newName: "" });
      await loadFolderBrowser(data.path); // descend into the new folder
    } catch (e) {
      toast(`mkdir failed: ${e.message}`, "error");
      updateFolderBrowser({ creating: false });
    }
};

window.addEventListener("pi-folder-browser-browse", (event) => loadFolderBrowser(event.detail));
window.addEventListener("pi-folder-browser-create", () => createFolderBrowser());
window.addEventListener("pi-folder-browser-cancel", () => { closeModal(); folderBrowserState.done?.(null); });
window.addEventListener("pi-folder-browser-submit", () => { closeModal(); folderBrowserState.done?.(folderBrowserState.browsePath); });

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

let fileExplorerState = {
  curPath: "",
  showHidden: true,
  editPath: "",
  editContent: "",
};

async function loadFileExplorer(path) {
  updateFileExplorer({ loading: true, mode: "list" });
  let data;
  try {
    data = await browseFiles(fetch, path);
  } catch (error) {
    updateFileExplorer({ loading: false });
    toast(error.message, "error");
    if (path !== workdir) return loadFileExplorer(workdir);
    return;
  }
  fileExplorerState.curPath = data.path;
  updateModal({ title: "📁 File explorer" });
  updateFileExplorer({
    mode: "list",
    path: data.path,
    home: data.home,
    workdir: data.workdir,
    parent: data.parent,
    dirs: data.dirs ?? [],
    files: data.files ?? [],
    showHidden: get(fileExplorer).showHidden,
    loading: false,
    token,
    uploadText: "⬆ Upload…",
    uploading: false,
  });
}

async function showFileExplorer() {
  // always open in the current session's working directory
  fileExplorerState = {
    curPath: workdir,
    showHidden: true,
    editPath: "",
    editContent: "",
  };
  updateFileExplorer({
    mode: "list",
    path: "",
    home: "",
    workdir: "",
    parent: null,
    dirs: [],
    files: [],
    showHidden: true,
    loading: true,
    token,
    editPath: "",
    editContent: "",
    saving: false,
    uploading: false,
    uploadText: "⬆ Upload…",
  });
  openModal({ title: "📁 File explorer", content: "fileExplorer" });
  await loadFileExplorer(fileExplorerState.curPath);
}

async function uploadExplorerFiles() {
  const dir = fileExplorerState.curPath;
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
      updateFileExplorer({
        uploading: true,
        uploadText: `<span class="spin">⟳</span> ${Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))}%`,
      });
    };
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
            ({ res: r, data: d } = await uploadFileChunk(fetch, {
              dir, name: f.name, offset, last: isLast, body: f.slice(offset, end),
            }));
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
    updateFileExplorer({ uploading: false, uploadText: "⬆ Upload…" });
    await loadFileExplorer(dir); // refresh the listing
  });
  inp.click();
}

async function editExplorerFile(path) {
  let data;
  try { data = await readFile(fetch, path); }
  catch (error) { toast(error.message, "error"); return; }

  fileExplorerState.editPath = path;
  fileExplorerState.editContent = data.content;
  updateModal({ title: `✎ ${path.split("/").pop()}` });
  updateFileExplorer({
    mode: "edit",
    loading: false,
    token,
    editPath: path,
    editContent: data.content,
    saving: false,
  });
}

async function saveExplorerFile() {
  const path = fileExplorerState.editPath;
  updateFileExplorer({ saving: true });
  try {
    const d = await saveFile(fetch, { path, content: get(fileExplorer).editContent });
    toast(`saved ${path.split("/").pop()} (${d.bytes} bytes)`);
  } catch (e) {
    toast(e.message, "error");
  } finally {
    updateFileExplorer({ saving: false });
  }
}

window.addEventListener("pi-file-explorer-browse", (event) => loadFileExplorer(event.detail));
window.addEventListener("pi-file-explorer-edit", (event) => editExplorerFile(event.detail));
window.addEventListener("pi-file-explorer-save", () => saveExplorerFile());
window.addEventListener("pi-file-explorer-upload", () => uploadExplorerFiles());
window.addEventListener("pi-file-explorer-back-list", () => loadFileExplorer(fileExplorerState.curPath));
window.addEventListener("pi-file-explorer-back-hublots", () => showHublots().catch((e) => toast(e.message, "error")));


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

async function refreshHublotManager({ loading = false } = {}) {
  updateHublotManager({
    loading,
    scopeAll: tunnelScopeAll,
    currentSessionId: state?.sessionId ?? null,
    desc: tunnelForm.desc,
  });
  try {
    const res = await fetch(`/tunnels`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
    updateHublotManager({
      loading: false,
      tunnels: (data.tunnels ?? []).filter(tunnelVisible),
      total: data.tunnels?.length ?? 0,
      scopeAll: tunnelScopeAll,
      currentSessionId: state?.sessionId ?? null,
      desc: tunnelForm.desc,
    });
  } catch (e) {
    updateHublotManager({ loading: false, tunnels: [], total: 0 });
    toast(`failed to list hublots: ${e.message}`, "error");
  }
}

async function showHublots() {
  // close the slide-over sidebars so they don't sit on top of the modal
  $("hublots").classList.remove("open");
  $("treebar").classList.remove("open");
  carousel = 0;
  localStorage.setItem("pi_carousel", "0");
  setCarouselDots();

  openModal({ title: tunnelScopeAll ? "Hublots — all sessions" : "Hublots — this session", wide: true, content: "hublotManager" });
  await refreshHublotManager({ loading: true });
}

async function createManagedHublot(descText) {
  const desc = (descText ?? "").trim();
  tunnelForm.desc = descText ?? "";
  updateHublotManager({ desc: tunnelForm.desc });
  if (!desc) { toast("describe what the hublot should expose", "warning"); return; }
  updateHublotManager({ creating: true });
  try {
    // no port sent: the server allocates the next free one from 3000 up;
    // a `brief` makes the server hand the setup to a background pi agent
    const data = await createHublot(fetch, { label: desc || null, sessionId: state?.sessionId ?? null, brief: desc });
    tunnelForm.desc = "";
    updateHublotManager({ desc: "" });
    closeModal();
    toast(`hublot opening at ${data.tunnel.url} — background agent is setting it up…`);
  } catch (e) {
    toast(`hublot failed: ${e.message}`, "error");
  } finally {
    updateHublotManager({ creating: false });
  }
}

async function toggleManagedHublotScope() {
  await refreshHublotScope({
    scopeAll: tunnelScopeAll,
    setScope: (scope) => { tunnelScopeAll = scope; },
    updateTitle: (scope) => updateModal({ title: scope ? "Hublots — all sessions" : "Hublots — this session" }),
    refreshManager: () => refreshHublotManager({ loading: true }),
    refreshSidebar: loadHublots,
    refreshRoutines: syncRoutinesStore,
  });
}

window.addEventListener("pi-managed-hublot-create", (event) => createManagedHublot(event.detail));

window.addEventListener("pi-managed-command-palette", (event) => setupCommandPalette(event.detail));
window.addEventListener("pi-managed-hublot-toggle-scope", () => toggleManagedHublotScope());

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
    tunnels = await listHublots(fetch, tunnelVisible);
  } catch { /* sidebar is best-effort */ }
  hublots.set(tunnels);
  hublotsLoading.set(false);
}

window.addEventListener("pi-open-file-explorer", () => showFileExplorer().catch((e) => toast(e.message, "error")));

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
    routinesNow = await listRoutines(fetch);
  } catch { /* sidebar is best-effort */ }
  // Session switches can issue overlapping sidebar refreshes; ignore stale
  // responses so the previous session's routines don't overwrite the current view.
  if (seq !== routinesLoadSeq || sessionAtStart !== (state?.sessionId ?? null)) return;
  syncRoutinesStore({ loading: false });
}

async function routineAction(name, action) {
  try {
    // start binds the routine to the current session (and its workdir)
    await runRoutine(fetch, { name, action, sessionId: state?.sessionId ?? null });
  } catch (e) {
    toast(`routine ${action} failed: ${e.message}`, "error");
  }
  loadRoutines();
}
window.addEventListener("pi-routine-action", (event) => routineAction(event.detail.name, event.detail.action));

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

let sessionPickerResolve = null;
let sessionPickerFolders = [];
let sessionPickerCurrentFolder = null;
let sessionPickerSessions = [];

function sessionPickerSnapshot() {
  let snapshot;
  const unsubscribe = sessionPicker.subscribe((state) => { snapshot = state; });
  unsubscribe();
  return snapshot;
}

function groupSearchResults(results) {
  const groups = new Map();
  for (const hit of results) {
    if (!groups.has(hit.sessionPath)) groups.set(hit.sessionPath, []);
    groups.get(hit.sessionPath).push(hit);
  }
  return [...groups.entries()].map(([sessionPath, hits]) => ({ sessionPath, hits, first: hits[0] }));
}

async function runSessionPickerSearch() {
  const snap = sessionPickerSnapshot();
  const q = snap.query.trim();
  if (q.length < 2) {
    updateSessionPicker({ searchStatus: "", searchResults: [], searching: false });
    return;
  }
  const scope = snap.scope;
  let path = "";
  if (scope === "folder") path = snap.folderPath ?? "";
  if (scope === "session") {
    const cur = snap.sessions.find((s) => s.id === snap.currentId) ?? snap.sessions[0];
    if (!cur) { updateSessionPicker({ searchStatus: "no saved session to search", searchResults: [] }); return; }
    path = cur.path;
  }
  updateSessionPicker({ searchStatus: "searching…", searchResults: [], searching: true });
  const params = new URLSearchParams({ token, q, scope });
  if (path) params.set("path", path);
  if (!snap.excludeTools) params.set("tools", "1"); // toggle off → include tool output
  try {
    const res = await fetch(`/search?${params}`);
    const data = await res.json();
    const latest = sessionPickerSnapshot();
    if (latest.query.trim() !== q || latest.scope !== scope) return;
    if (!res.ok) {
      updateSessionPicker({ searchStatus: data.error || `search failed (${res.status})`, searchResults: [], searching: false });
      return;
    }
    updateSessionPicker({
      searchStatus: `${data.results.length} hit${data.results.length === 1 ? "" : "s"} in ${data.filesSearched} file${data.filesSearched === 1 ? "" : "s"}` + (data.truncated ? " (truncated)" : ""),
      searchResults: groupSearchResults(data.results),
      searchFilesSearched: data.filesSearched,
      searchTruncated: !!data.truncated,
      searching: false,
    });
  } catch (e) {
    updateSessionPicker({ searchStatus: `search failed: ${e.message}`, searchResults: [], searching: false });
  }
}

function updateSessionPickerRunners(runners = runnersNow) {
  updateSessionPicker({ runners });
}

async function refreshSessionPickerCurrentFolder() {
  const dirQ = workdir ? `?dir=${encodeURIComponent(workdir)}` : "";
  const res = await fetch(`/sessions${dirQ}`);
  if (!res.ok) throw new Error(`failed to list sessions (${res.status})`);
  const { sessions } = await res.json();
  sessionPickerSessions = sessions;
  updateSessionPicker({ sessions, runners: runnersNow });
}

async function loadSessionPickerFolder(folder) {
  const snap = sessionPickerSnapshot();
  if (snap.otherFolderSessions[folder.dir]) return;
  updateSessionPicker({ loadingFolders: { ...snap.loadingFolders, [folder.dir]: true } });
  try {
    const res = await fetch(`/sessions?path=${encodeURIComponent(folder.dir)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
    const latest = sessionPickerSnapshot();
    updateSessionPicker({
      otherFolderSessions: { ...latest.otherFolderSessions, [folder.dir]: data.sessions ?? [] },
      loadingFolders: { ...latest.loadingFolders, [folder.dir]: false },
      runners: runnersNow,
    });
  } catch (e) {
    const latest = sessionPickerSnapshot();
    updateSessionPicker({ loadingFolders: { ...latest.loadingFolders, [folder.dir]: false } });
    toast(`failed to list ${folder.label}: ${e.message}`, "error");
  }
}

const sessionPickerActions = {
  setScope: (scope) => { updateSessionPicker({ scope }); runSessionPickerSearch(); },
  setFolder: (folderPath) => { updateSessionPicker({ folderPath }); runSessionPickerSearch(); },
  setExcludeTools: (excludeTools) => { updateSessionPicker({ excludeTools }); runSessionPickerSearch(); },
  runSearch: runSessionPickerSearch,
  chooseSession: (sessionPath) => {
    const session = sessionPickerSessions.find((item) => item.path === sessionPath) ?? null;
    closeModal();
    sessionPickerResolve?.(session);
  },
  stopSession: async (session) => {
    const runner = runnersNow.find((x) => x.sessionFile === session.path) ?? { id: session.runnerId };
    if (!runner.id) return;
    try {
      await stopSessionRunner(fetch, runner.id);
      toast("process stopped");
      updateSessionPickerRunners(runnersNow.map((r) => r.id === runner.id ? { ...r, alive: false, busy: false } : r));
    } catch (err) {
      toast(`stop failed: ${err.message}`, "error");
    }
  },
  deleteSession: async (session) => {
    if (!confirm(`Delete session "${session.name || session.preview || session.id?.slice(0, 8) || "?"}"?`)) return;
    try {
      const res = await fetch(`/session?path=${encodeURIComponent(session.path)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || `delete failed (${res.status})`, "error"); return; }
      sessionPickerSessions = sessionPickerSessions.filter((s) => s.path !== session.path);
      updateSessionPicker({ sessions: sessionPickerSessions });
      const bits = [];
      if (data.closedHublots?.length) bits.push(`closed hublot${data.closedHublots.length > 1 ? "s" : ""} :${data.closedHublots.join(", :")}`);
      if (data.releasedRoutines?.length) bits.push(`released routine${data.releasedRoutines.length > 1 ? "s" : ""} ${data.releasedRoutines.join(", ")}`);
      toast(bits.length ? `session deleted · ${bits.join(" · ")}` : "session deleted");
      if (data.closedHublots?.length) loadHublots();
      if (data.releasedRoutines?.length) loadRoutines();
    } catch (err) {
      toast(`delete failed: ${err.message}`, "error");
    }
  },
  openSearchHit: (sessionPath, hit) => {
    sessionPickerResolve?.(null);
    openSearchHit(sessionPath, hit);
  },
  loadFolder: loadSessionPickerFolder,
};
window.addEventListener("pi-session-picker-action", (event) => {
  const { type, args } = event.detail ?? {};
  return sessionPickerActions[type]?.(...(args ?? []));
});
window.addEventListener("pi-session-picker-cancel", () => { closeModal(); sessionPickerResolve?.(null); });

async function showSessionPicker() {
  // list the sessions of the CURRENT session's directory, not the server's
  // last-set global workdir
  const dirQ = workdir ? `?dir=${encodeURIComponent(workdir)}` : "";
  const res = await fetch(`/sessions${dirQ}`);
  if (!res.ok) { toast(`failed to list sessions (${res.status})`, "error"); return; }
  const { sessions } = await res.json();
  if (!sessions.length) { toast("no saved sessions"); return; }
  sessionPickerSessions = sessions;
  const currentSessionFile = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
  const currentId = sessions.find((session) => session.path === currentSessionFile)?.id ?? state?.sessionId;

  // folders for the search scope selector and the "other folders" section
  let folders = [], currentFolder = null;
  try {
    const r = await fetch(`/session-folders${dirQ}`);
    const d = await r.json();
    if (r.ok) { folders = d.folders; currentFolder = d.current; }
  } catch {}
  sessionPickerFolders = folders;
  sessionPickerCurrentFolder = currentFolder;

  onRunnersUpdate = (runners) => updateSessionPicker({ runners });

  const chosen = await new Promise((resolve) => {
    sessionPickerResolve = resolve;
    updateSessionPicker({
      sessions,
      folders,
      currentFolder,
      currentId,
      currentWorkdir: workdir,
      runners: runnersNow,
      query: "",
      scope: "all",
      folderPath: currentFolder ?? folders[0]?.dir ?? "",
      excludeTools: true,
      searchStatus: "",
      searchResults: [],
      searchFilesSearched: 0,
      searchTruncated: false,
      searching: false,
      otherFolderSessions: {},
      loadingFolders: {},
    });
    openModal({ title: "Sessions", content: "sessionPicker" });
  });

  onRunnersUpdate = null;
  sessionPickerResolve = null;
  const currentPath = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
  const fullChoice = chosen ? (sessionPickerSessions.find((session) => session.path === chosen.path || session.id === chosen.id) ?? chosen) : null;
  if (!fullChoice) return;
  try {
    // attaches to the session's live runner if it has one (its work is
    // untouched), else spawns a fresh pi on that session in the background;
    // sessions from other folders spawn in their own recorded cwd
    const runner = await openSessionRunner({ sessionPath: fullChoice.path, dir: fullChoice.cwd || workdir });
    switchToRunner(runner.id);
    toast(`switched to: ${fullChoice.name || fullChoice.preview || fullChoice.id.slice(0, 8)}`);
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
    await focusSearchHit(hit);
    return;
  }

  const focus = () => { focusSearchHit(hit); };

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

async function focusSearchHit(hit) {
  if (hit.entryId) {
    await focusEntryById(hit.entryId);
    return;
  }
  if (!focusMessageBySnippet(hit.snippet)) toast("match not visible in transcript", "warning");
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
  const res = await fetch(`/session-entries?${sessionFileQuery(path)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
  return data.entries ?? [];
}

const normText = (s) => s.replace(/\s+/g, " ").trim();

/** does this entry plausibly describe this element? (labels like "[tool: …]"
 *  never appear verbatim in the DOM, so only verify real text) */
function entryMatchesEl(entry, el) {
  return messageEntryMatchesElement(entry, el);
}

function entryForElement(entries, els, el) {
  const idx = els.indexOf(el);
  if (idx === -1 || !entries.length) return null;
  // same length -> zip by index; otherwise align from the end (the file can
  // briefly run ahead of / behind the rendered transcript while streaming)
  const pos = entries.length === els.length ? idx : entries.length - (els.length - idx);
  if (pos >= 0 && pos < entries.length && entryMatchesEl(entries[pos], el)) return entries[pos];
  const found = entries.find((e) => e.role === el.dataset.role && e.text && !e.text.startsWith("[")
    && normText(el.textContent).includes(normText(e.text).slice(0, 60)));
  return found ?? (pos >= 0 && pos < entries.length ? entries[pos] : null);
}

async function annotateTranscriptEntries() {
  const entries = await fetchSessionEntries();
  const els = chatEls();
  for (const el of els) {
    const entry = entryForElement(entries, els, el);
    if (entry?.id) el.dataset.entryId = entry.id;
  }
}

async function entryIdForElement(el) {
  if (el?.dataset?.entryId) return el.dataset.entryId;
  const entries = await fetchSessionEntries();
  const entry = entryForElement(entries, chatEls(), el);
  if (entry?.id) {
    el.dataset.entryId = entry.id;
    return entry.id;
  }
  return null;
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
    await annotateTranscriptEntries();
    const direct = messagesEl.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
    if (direct) { flashEl(direct); return; }
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
    if (entry.id) el.dataset.entryId = entry.id;
    flashEl(el);
  } catch (e) {
    toast(`permalink: ${e.message}`, "warning");
  }
}

// ------------------------------------------------------------ modal helpers

const overlay = $("overlay");

function closeModal() {
  closeModalState();
}

window.addEventListener("pi-settings-changed", () => reloadTranscript().catch(() => {}));

/** Settings modal — rendered by Svelte; legacy only opens the modal shell. */
async function showSettingsModal() {
  openModal({ title: "Settings", content: "settings" });
}

function pickOption(title, options, { searchable = false } = {}) {
  return openOptionPicker(title, options, { searchable });
}

function promptText(title, placeholder, prefill) {
  return openTextPrompt(title, placeholder, prefill);
}

function confirmDialog(title, message) {
  return openConfirmPrompt(title, message);
}

function promptEditor(title, placeholder, prefill) {
  return openEditorPrompt(title, placeholder, prefill);
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
      const v = await promptEditor(req.title, "", req.prefill);
      if (v == null) respond({ cancelled: true });
      else respond({ value: v });
      return;
    }
    case "setTitle":
      updateAppSession({ titleOverride: req.title });
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

document.addEventListener("pi:header", (event) => {
  const { action, sourceEvent } = event.detail ?? {};
  if (action === "chooseModel") chooseModel();
  else if (action === "cycleThinking") cycleThinking();
  else if (action === "openConfig") openConfigPicker();
  else if (action === "toggleHublots") toggleHublotsFromHeader(sourceEvent);
  else if (action === "toggleTree") toggleTreeFromHeader(sourceEvent);
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
  lifecycleLog("boot:start", { routeSessionId: route.sessionId, routeMessageId: route.messageId, storedRunner: currentRunner });
  if (route.sessionId) {
    try {
      const lookupStarted = performance.now();
      lifecycleLog("boot:session-lookup:start", { routeSessionId: route.sessionId });
      const res = await fetch(`/session-by-id?id=${encodeURIComponent(route.sessionId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `lookup failed (${res.status})`);
      lifecycleLog("boot:session-lookup:done", { status: res.status, sessionPath: data.session?.path, cwd: data.session?.cwd, ms: Math.round(performance.now() - lookupStarted) });
      const r = await openSessionRunner({ sessionPath: data.session.path, dir: data.session.cwd || null });
      setRunner(r.id);
      lifecycleLog("boot:set-runner", { runner: r.id });
      if (route.messageId) {
        const mid = route.messageId;
        afterTranscript = () => focusEntryById(mid);
      }
    } catch (e) {
      lifecycleLog("boot:error", { error: e?.message ?? String(e) });
      toast(`could not open linked session: ${e.message}`, "warning");
    }
  }
  lifecycleLog("boot:connect");
  connect();
}

if (!token) requireToken();
else boot();
