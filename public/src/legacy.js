"use strict";

import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { createAuthProbe, initializeAuth, installAuthenticatedFetch } from "./runtime/authClient.js";
import { createRpcClient } from "./runtime/rpcClient.js";
import { createSseDeduper } from "./runtime/eventStreamUtils.js";
import { createAssistantStream, createRenderJobs, createToolCardRegistry, createTranscriptScrollAdapter, filterReplayEvents, registerTranscriptLoadScroll, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "./runtime/transcriptRuntime.js";
import { handleReplayDone, handleRunnerPing, registerCheckpointTreeEvents, registerCommandPaletteEvents, registerCommandPaletteInput, registerCommandPaletteKeyboard, registerComposerEvents, registerFileExplorerEvents, registerFilePickerEvents, registerFileUploadInput, registerFolderBrowserEvents, registerHeaderEvents, registerHublotSidebarEvents, registerManagedHublotEvents, registerMenuEvents, registerMobileDrawerDismiss, registerOpenFileExplorerEvent, registerRoutineEvents, registerSessionPickerEvents, registerSettingsEvents, registerSwipeAndResizeEvents } from "./runtime/eventControllers.js";
import { createConnectionStateTransitions, createEventStreamRuntime, processEventMessage, runCanonicalReload, runReconnectWatchdog } from "./runtime/eventStream.js";
import { createCarouselController, createCarouselHeaderController, createCarouselSwipeController, registerCarouselEvents } from "./runtime/carouselController.js";
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
import { alignedTranscriptIndex, splitTurns, takeTailChunk } from "./lib/transcriptUtils.js";
import { backfillTranscriptTurns } from "./lib/transcriptBackfill.js";
import { createTranscriptActions } from "./lib/transcriptActions.js";
import { adjacentActiveRunner, applySessionState, createStateRefresher, fetchSessionPreview, formatSessionDate, groupSessionSearchResults, markRunnerStopped, openSession, parseSessionRoute, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl, usageInfo } from "./lib/sessionActions.js";
import { checkpointResultMessage, createCheckpoint, openCheckpointModelPicker as openModelPicker, rollbackCheckpoint } from "./lib/checkpointActions.js";
import { createCheckpointController } from "./lib/checkpointController.js";
import { createCheckpointMarkerController } from "./lib/checkpointMarkerController.js";
import { commandTrigger, createCommandGuard, filterCommands } from "./lib/commandActions.js";
import { promptCommand } from "./lib/promptActions.js";
import { insertionAtCaret, insertionReplacing } from "./lib/textInsertion.js";
import { createCheckpointTreeController } from "./lib/checkpointTreeController.js";
import { createHublot, hublotVisible, listHublots, refreshHublotScope } from "./lib/hublotActions.js";
import { createHublotController } from "./lib/hublotController.js";
import { createHublotManagerController } from "./lib/hublotManagerController.js";
import { createFolderBrowserController } from "./lib/folderBrowserController.js";
import { listRoutines, routineVisible as isRoutineVisible, runRoutine } from "./lib/routineActions.js";
import { createRoutineController } from "./lib/routineController.js";
import { createSettingsController } from "./lib/settingsController.js";
import { createSessionPickerController } from "./lib/sessionPickerController.js";
import { createSessionPickerSearchController } from "./lib/sessionPickerSearchController.js";
import { storeSnapshot } from "./lib/storeSnapshot.js";
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

const route = parseSessionRoute(location.pathname);
const syncUrlToSession = (sessionId) => syncSessionUrl({ location, history, sessionId });

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
const scroller = $("scroller");
const transcriptScroll = createTranscriptScrollAdapter({ scroller });
const nearBottom = () => transcriptScroll.nearBottom();
const scrollToBottom = (force) => transcriptScroll.scrollToBottom(force);
// late-loading content (images in markdown) grows the transcript after our
// scroll corrections ran; if the user is at the bottom, stay pinned there
registerTranscriptLoadScroll(messagesEl, scrollToBottom);

const toolCards = createToolCardRegistry({
  createStore: writable,
  resultText: toolResultText,
});

function ensureToolCardStore(toolCall) {
  return toolCards.ensure(toolCall);
}

function finishToolCard(toolCallId, resultMsgOrText, isError) {
  toolCards.finish(toolCallId, resultMsgOrText, isError);
}

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

const assistantStream = createAssistantStream({
  mount: (message) => mountSvelteAssistantMessage(message),
  update: updateSvelteAssistant,
  finish: (message) => addSvelteAssistantMessage(message),
});

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

/** Modal with a single model selector for the diff-summary sub-agent; the
 *  choice is remembered (localStorage) and preselected next time. */
function pickCheckpointModel(options = {}) {
  return openModelPicker({
    openPicker: openCheckpointModelPicker,
    rpc,
    setOptions: updateCheckpointModelOptions,
    options,
  });
}

const checkpointMarkerController = createCheckpointMarkerController({
  tick,
  chatElements: chatEls,
  setTarget: setCheckpointTarget,
  setRestores: setCheckpointRestores,
  fetchImpl: fetch,
  getSessionId: () => state?.sessionId,
  fetchSessionEntries,
});
const placeCheckpointBtn = () => checkpointMarkerController.place();
const refreshCheckpointMarkers = () => checkpointMarkerController.refresh();


// ------------------------------------------------------------ checkpoint / fork tree sidebar
//
// The ⎇ chip toggles a right sidebar showing the current session's whole
// family: its root ancestor, every fork (nested under the checkpoint it was
// created from), and each session's checkpoints. Sessions switch on tap;
// checkpoints roll back on tap.

const checkpointTreeController = createCheckpointTreeController({
  fetchImpl: fetch,
  getState: () => state,
  getRunners: () => runnersNow,
  getCurrentRunner: () => currentRunner,
  getWorkdir: () => workdir,
  setTreeState: setCheckpointTreeState,
  isOpen: () => $("treebar").classList.contains("open"),
  openSession: openSessionRunner,
  switchRunner: switchToRunner,
  toast,
});
const refreshTreeIfOpen = () => checkpointTreeController.refreshIfOpen();
const loadCheckpointTree = () => checkpointTreeController.load();
const checkpointController = createCheckpointController({
  pickModel: pickCheckpointModel,
  createCheckpoint: (runner, model) => createCheckpoint(fetch, runner, model),
  rollbackCheckpoint: (options) => rollbackCheckpoint(fetch, options),
  resultMessage: checkpointResultMessage,
  getRunner: () => currentRunner,
  getSessionId: () => state?.sessionId,
  setBusy: setCheckpointBusy,
  setRestoreBusy: setCheckpointRestoreBusy,
  refreshMarkers: refreshCheckpointMarkers,
  refreshTree: refreshTreeIfOpen,
  switchRunner: switchToRunner,
  toast,
});
function handleCheckpointClick(event) { return checkpointController.freeze(event); }
function rollbackToCheckpoint(checkpoint, target = null) { return checkpointController.rollback(checkpoint, target); }

registerCheckpointTreeEvents(window, {
  openSession: checkpointTreeController.openTreeSession,
  rollback: rollbackToCheckpoint,
});

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
  renderJobs.cancel(); // cancel any in-flight transcript backfill
  setCheckpointTarget(null);
  setCheckpointRestores([]);
  resetTranscriptItems();
  toolCards.clear();
  assistantStream.clear();
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

const renderJobs = createRenderJobs();
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
  const myJob = renderJobs.begin();
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
    isCurrent: () => renderJobs.isCurrent(myJob),
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
    lifecycleLog("renderTranscript:superseded", { job: myJob, activeJob: renderJobs.current });
    return false;
  }
  placeCheckpointBtn();
  lifecycleLog("renderTranscript:complete", { job: myJob, domMessages: messagesEl.children.length });
  return true;
}

// ------------------------------------------------------------ state / header

let state = null;

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
      carouselController.reset();
    },
    renderPreview: renderPreviewNow,
    resetCommands: () => commandGuard?.reset(),
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
  const info = usageInfo(message?.usage);
  if (info) updateHeaderState({ usageInfo: info });
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
function flushReplayBufferedEvents(events) {
  lifecycleLog("replayBuffer:flush", { events: events.length, types: events.map((event) => event.type).slice(0, 20) });
  // If get_messages completed after the live assistant already finished, the
  // canonical render already contains that answer. In that case, dropping the
  // buffered assistant/tool sequence avoids painting a duplicate while still
  // preserving the normal in-progress case (no message_end yet) where buffered
  // deltas are the only copy the user can see without a refresh.
  for (const event of filterReplayEvents(events, assistantAlreadyRendered)) handleEvent(event);
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
  if (replaying && transcriptGateRequired && REPLAY_GATED_EVENT_TYPES.has(msg.type)) {
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
      assistantStream.clear();
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
        assistantStream.start(m);
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
        assistantStream.update(m);
        scrollToBottom(false);
      }
      return;
    }

    case "message_end": {
      const m = msg.message;
      if (m.role === "assistant") {
        assistantStream.end(m);
        updateUsage(m);
      } else if (m.role === "toolResult") {
        finishToolCard(m.toolCallId, m, m.isError);
      }
      scrollToBottom(false);
      return;
    }

    case "tool_execution_start":
      toolCards.start(msg.toolCallId);
      return;

    case "tool_execution_update":
      toolCards.updateResult(msg.toolCallId, msg.partialResult);
      return;

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
  const { messages } = await loadDurableCanonicalTranscript({
    rpc,
    applyState,
    fetchImpl: fetch,
    sessionFileQuery,
    onState: (s) => lifecycleLog("reloadTranscript:get_state:done", { ms: Math.round(performance.now() - started), messageCount: s?.messageCount ?? null, sessionFile: s?.sessionFile ?? null }),
    onMessages: (result) => lifecycleLog("reloadTranscript:get_messages:done", { ms: Math.round(performance.now() - started), messages: result?.messages?.length ?? 0 }),
    onDurableMessages: (result) => lifecycleLog("reloadTranscript:session-messages:done", { ms: Math.round(performance.now() - started), messages: result?.messages?.length ?? 0 }),
  });
  lastPreview = null; // canonical content from pi supersedes the file preview
  const complete = await reconcileTranscriptReload({
    messages,
    render: renderTranscript,
    setReplaying,
    takeBufferedEvents: () => {
      const buffered = replayBufferedEvents;
      replayBufferedEvents = [];
      return buffered;
    },
    flushBufferedEvents: flushReplayBufferedEvents,
    afterRender: async () => {
      annotateTranscriptEntries().catch(() => {});
      refreshCheckpointMarkers().catch(() => {});
      refreshTreeIfOpen();
      const cb = afterTranscript;
      afterTranscript = null;
      cb?.();
    },
  });
  lifecycleLog("reloadTranscript:render-complete", { complete, ms: Math.round(performance.now() - started) });
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

const refreshStateNow = createStateRefresher({
  rpc: async (request) => {
    const started = performance.now();
    lifecycleLog("refreshState:start");
    const value = await rpc(request);
    lifecycleLog("refreshState:done", { ms: Math.round(performance.now() - started) });
    return value;
  },
  applyState,
  onError: (e) => lifecycleLog("refreshState:error", { error: e?.message ?? String(e) }),
});
function refreshState() {
  lifecycleLog("refreshState:scheduled");
  refreshStateNow();
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
let commandGuard = createCommandGuard({ rpc, confirm: confirmDialog });

const promptRpcCommand = (text) => promptCommand(text, busy);

async function send() {
  const text = input.value.trim();
  if (!text || !composerReadyForSend()) return;
  // guard against typos like "/goal": an unknown slash command is not
  // expanded by pi — it goes to the model as plain text, which can kick off
  // a long unwanted agent run
  if (!await commandGuard.confirmKnownCommand(text)) return; // text stays in the composer
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

registerComposerEvents(document, {
  inputChanged: composerInputChanged,
  keydown: composerKeydown,
  send,
  abort,
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

const getCommandTrigger = commandTrigger;
const getFilteredCommands = (match) => filterCommands(commands, match);

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
function applyTextInsertion(element, insertion) {
  element.value = insertion.value;
  element.setSelectionRange(insertion.position, insertion.position);
  element.dispatchEvent(new Event("input"));
  element.focus();
}

function insertAtTextarea(element, placeholder, text) {
  applyTextInsertion(element, insertionReplacing(element.value, placeholder, text)
    ?? insertionAtCaret(element.value, element.selectionStart, element.selectionEnd, text));
}

function appendAtCaret(element, text) {
  applyTextInsertion(element, insertionAtCaret(element.value, element.selectionStart, element.selectionEnd, text));
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
  registerCommandPaletteInput(el, {
    onInput: () => {
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
    },
    onBlur: () => setTimeout(() => {
      if (cmdState?.target === el) closeCmdPalette();
    }, 150),
  });
}

registerCommandPaletteEvents(window, { run: runCmdIndex });

setupCommandPalette(input);

// global keydown: palette navigation while it's open (capture = fires first)
registerCommandPaletteKeyboard(document, {
  isOpen: () => cmdPalette.classList.contains("open"),
  move: moveCmd,
  run: runActiveCmd,
  close: closeCmdPalette,
});

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
registerMenuEvents(window, { run: runMenuAction });

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

registerFilePickerEvents(window, {
  useFolder: () => { filePickerState.onPick?.(filePickerState.curDir); finishFilePicker(); },
  browse: loadFilePicker,
  pick: (path) => { filePickerState.onPick?.(path); finishFilePicker(); },
  cancel: () => { filePickerState.onCancel?.(); finishFilePicker(); },
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

const folderBrowserController = createFolderBrowserController({
  async browse(path) { const q = path ? `?path=${encodeURIComponent(path)}` : ""; const res = await fetch(`/browse${q}`); const data = await res.json(); if (!res.ok) throw new Error(data.error || "cannot open folder"); return data; },
  update: updateFolderBrowser,
  updateTitle: (title) => updateModal({ title }),
  getShowHidden: () => get(folderBrowser).showHidden,
  setPath: (path) => { folderBrowserState.browsePath = path; },
  toast,
});
const loadFolderBrowser = folderBrowserController.load;

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

registerFolderBrowserEvents(window, {
  browse: loadFolderBrowser,
  create: createFolderBrowser,
  cancel: () => { closeModal(); folderBrowserState.done?.(null); },
  submit: () => { closeModal(); folderBrowserState.done?.(folderBrowserState.browsePath); },
});

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
  registerFileUploadInput(inp, async () => {
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

registerFileExplorerEvents(window, {
  browse: loadFileExplorer,
  edit: editExplorerFile,
  save: saveExplorerFile,
  upload: uploadExplorerFiles,
  backToList: () => loadFileExplorer(fileExplorerState.curPath),
  backToHublots: () => showHublots().catch((e) => toast(e.message, "error")),
});


// Tunnels are bound to the session they were opened in; the modal and the
// hublot sidebar show the current session's tunnels by default, with a
// toggle to see every session's.
let tunnelScopeAll = false;

function tunnelVisible(tunnel) {
  // unbound tunnels (opened before session binding existed) stay visible
  return hublotVisible(tunnel, tunnelScopeAll, state?.sessionId);
}

// new-tunnel form values survive modal re-renders (e.g. attach-file detour)
const tunnelForm = { desc: "" };

async function refreshHublotManager(options) { return hublotController.refresh(options); }

const hublotManagerController = createHublotManagerController({
  resetCarousel: () => carouselController.reset(),
  openModal,
  refresh: refreshHublotManager,
  getScopeAll: () => tunnelScopeAll,
});
const showHublots = hublotManagerController.show;

const hublotController = createHublotController({
  createHublot: (options) => createHublot(fetch, options),
  getSessionId: () => state?.sessionId ?? null,
  setDescription: (desc) => { tunnelForm.desc = desc; updateHublotManager({ desc }); },
  setCreating: (creating) => updateHublotManager({ creating }),
  close: closeModal,
  toast,
  listHublots: async () => { const res = await fetch("/tunnels"); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `failed (${res.status})`); return data.tunnels ?? []; },
  isVisible: tunnelVisible,
  updateManager: updateHublotManager,
  getScopeAll: () => tunnelScopeAll,
  getDescription: () => tunnelForm.desc,
});
const createManagedHublot = hublotController.create;

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

registerManagedHublotEvents(window, {
  create: createManagedHublot,
  openCommandPalette: setupCommandPalette,
  toggleScope: toggleManagedHublotScope,
});

// ------------------------------------------------------------ hublot sidebar

registerHublotSidebarEvents($("hublotAdd"), {
  show: () => showHublots().catch((e) => toast(e.message, "error")),
});

// mobile: toggle the hublots sidebar as a slide-over drawer
// tap outside the drawer closes it (mobile only — on desktop they're
// docked, not overlays). Sync the carousel state so applyCarousel()
// doesn't immediately re-open it.
registerMobileDrawerDismiss(document, {
  isMobile: () => window.matchMedia("(max-width: 760px)").matches,
  hublots: $("hublots"),
  treebar: $("treebar"),
  isToggleTarget: (target) => target.closest("#hublotChip") || target.closest("#treeChip"),
  close: () => {
    carouselController.reset();
  },
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

registerOpenFileExplorerEvent(window, { open: () => showFileExplorer().catch((e) => toast(e.message, "error")) });

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

function routineVisible(routine) {
  return isRoutineVisible(routine, tunnelScopeAll, state?.sessionId);
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

const routineController = createRoutineController({
  runRoutine: (options) => runRoutine(fetch, options),
  getSessionId: () => state?.sessionId ?? null,
  refresh: loadRoutines,
  toast,
});
registerRoutineEvents(window, { run: routineController.run });

// ------------------------------------------------------------ session picker

const fmtSessionDate = formatSessionDate;

let sessionPickerResolve = null;
let sessionPickerFolders = [];
let sessionPickerCurrentFolder = null;
let sessionPickerSessions = [];

const sessionPickerSnapshot = () => storeSnapshot(sessionPicker);

const groupSearchResults = groupSessionSearchResults;

const sessionPickerSearchController = createSessionPickerSearchController({
  getSnapshot: sessionPickerSnapshot,
  update: updateSessionPicker,
  groupResults: groupSearchResults,
  async fetchSearch({ q, scope, path, includeTools }) {
    const params = new URLSearchParams({ token, q, scope });
    if (path) params.set("path", path);
    if (includeTools) params.set("tools", "1");
    const res = await fetch(`/search?${params}`);
    return { ok: res.ok, status: res.status, data: await res.json() };
  },
});
const runSessionPickerSearch = sessionPickerSearchController.search;

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

const sessionPickerController = createSessionPickerController({
  stopRunner: (id) => stopSessionRunner(fetch, id),
  getRunners: () => runnersNow,
  markStopped: markRunnerStopped,
  setRunners: updateSessionPickerRunners,
  toast,
});

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
  stopSession: sessionPickerController.stopSession,
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
registerSessionPickerEvents(window, {
  dispatch: (type, ...args) => sessionPickerActions[type]?.(...args),
  cancel: () => { closeModal(); sessionPickerResolve?.(null); },
});

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

const settingsController = createSettingsController({ rpc, pickOption, refreshState, toast, getState: () => state });
const chooseModel = settingsController.chooseModel;
const cycleThinking = settingsController.cycleThinking;
const openConfigPicker = settingsController.openConfig;

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
  const pos = alignedTranscriptIndex(entries.length, els.length, idx);
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
      : els[alignedTranscriptIndex(entries.length, els.length, pos)] ?? null;
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

registerSettingsEvents(window, { changed: () => reloadTranscript().catch(() => {}) });

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

const carouselController = createCarouselController({
  documentTarget: document,
  windowTarget: window,
  storage: localStorage,
  setPage: setCarouselPage,
  loadHublots: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
});

const applyCarousel = () => carouselController.apply();
const swipeController = createCarouselSwipeController({
  isDesktop: () => window.matchMedia("(min-width: 761px)").matches,
  step: (direction) => carouselController.step(direction),
  switchRunner: switchToAdjacentRunner,
});

// Find sessions the user would consider "active": alive, has a real
// session bound (sessionId + sessionName), and lives in the current
// workdir. Runners with sessionName === null were spawned but never sent
// a message to — they're background/orphan processes, skip them.
function switchToAdjacentRunner(dir) {
  const { candidates, target } = adjacentActiveRunner(runnersNow, currentRunner, workdir, dir);
  if (candidates.length <= 1) {
    toast(candidates.length === 0 ? "no other active session" : "only one active session");
    return;
  }
  if (!target || target.id === currentRunner) return;
  switchToRunner(target.id);
}

function attachSwipeListeners() {
  registerCarouselEvents({
    state: window._piCarouselEvents ??= {},
    register: registerSwipeAndResizeEvents,
    handlers: {
      documentTarget: document,
      windowTarget: window,
      onTouchStart: swipeController.onTouchStart,
      onTouchMove: swipeController.onTouchMove,
      onTouchEnd: swipeController.onTouchEnd,
      onTouchCancel: swipeController.onTouchCancel,
      onResize: applyCarousel,
    },
  });
}

const carouselHeaderController = createCarouselHeaderController({
  isDesktop: () => window.matchMedia("(min-width: 761px)").matches,
  hublots: $("hublots"),
  treebar: $("treebar"),
  loadHublots: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
  carousel: carouselController,
});

registerHeaderEvents(document, {
  chooseModel,
  cycleThinking,
  openConfig: openConfigPicker,
  toggleHublots: carouselHeaderController.toggleHublots,
  toggleTree: carouselHeaderController.toggleTree,
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
