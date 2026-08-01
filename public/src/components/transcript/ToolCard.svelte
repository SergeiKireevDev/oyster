<script>
  import { summarizeToolArgs } from "../../lib/messageUtils.js";

  /**
   * @typedef {object} ToolCall
   * @property {string} [name]
   * @property {Record<string, unknown>} [arguments]
   *
   * @typedef {object} ToolCardState
   * @property {ToolCall} [toolCall]
   * @property {"running" | "error" | "ok"} [status]
   * @property {string} [resultText]
   *
   * @typedef {object} ReadableToolCard
   * @property {(run: (value: ToolCardState) => void) => (() => void)} subscribe
   *
   * @typedef {object} ToolCardProps
   * @property {ReadableToolCard} cardStore
   */

  /** @type {ToolCardProps} */
  let { cardStore } = $props();

  const MAX_RESULT_LENGTH = 20_000;
  const card = $derived($cardStore ?? {});
  const name = $derived(typeof card.toolCall?.name === "string" ? card.toolCall.name : "");
  const args = $derived(card.toolCall?.arguments);
  const argSummary = $derived(summarizeToolArgs(name, args));
  const isEdit = $derived(Boolean(
    name.toLowerCase() === "edit" && args && Array.isArray(args.edits),
  ));
  const statusText = $derived(card.status === "running" ? "Running" : card.status === "error" ? "Failed" : "Done");
  const statusClass = $derived(card.status === "running" ? "running" : card.status === "error" ? "err" : "ok");
  const resultText = $derived(formatResult(card.resultText));
  const argsText = $derived(formatArguments(args));
  const renderedDiffLines = $derived(isEdit ? diffLines(args.edits) : []);
  const hasDetails = $derived(Boolean(renderedDiffLines.length || (!isEdit && argsText) || resultText));
  const detailsLabel = $derived(`Show ${name || "tool"} details`);

  /** @param {unknown} value */
  function formatArguments(value) {
    if (value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2) ?? "";
    } catch {
      return "[Unable to display tool arguments]";
    }
  }

  /** @param {unknown} value */
  function formatResult(value) {
    const text = value == null ? "" : String(value);
    return text.length > MAX_RESULT_LENGTH
      ? `${text.slice(0, MAX_RESULT_LENGTH)}\n… (truncated)`
      : text;
  }

  /**
   * @param {Array<{oldText?: unknown, newText?: unknown} | null>} edits
   * @returns {Array<{className: string, text: string}>}
   */
  function diffLines(edits = []) {
    const lines = [];
    edits.forEach((edit, index) => {
      if (edits.length > 1) lines.push({ className: "diff-hdr", text: `edit ${index + 1}:` });
      for (const line of String(edit?.oldText ?? "").split("\n")) lines.push({ className: "diff-del", text: `- ${line}` });
      for (const line of String(edit?.newText ?? "").split("\n")) lines.push({ className: "diff-add", text: `+ ${line}` });
    });
    return lines;
  }
</script>

<details class="block tool tool-card activity-step">
  <summary title={detailsLabel}>
    <span class="tool-chevron" aria-hidden="true">›</span>
    <span class={`activity-indicator ${statusClass}`} aria-hidden="true"></span>
    <span class="tname">{name || "Tool"}</span>
    <span class="targ">{argSummary}</span>
    <span class={`status ${statusClass}`} aria-live="off">{statusText}</span>
  </summary>
  <div class="body">
    {#if isEdit && renderedDiffLines.length}
      <div class="diff" aria-label="Tool edits">
        {#each renderedDiffLines as line (line)}
          <div class={`diff-line ${line.className}`}>{line.text}</div>
        {/each}
      </div>
    {:else if !isEdit && argsText}
      <pre class="args-pre" aria-label="Tool arguments">{argsText}</pre>
    {/if}
    {#if resultText}
      <pre class="result-pre" aria-label="Tool result">{resultText}</pre>
    {/if}
    {#if !hasDetails}
      <p class="empty-detail">No details returned.</p>
    {/if}
  </div>
</details>

<style>
  .tool-card {
    min-width: 0;
    max-width: 100%;
  }

  .tool-card > summary {
    min-width: 0;
    border-radius: 7px;
  }

  .tool-chevron {
    width: 10px;
    flex: none;
    color: color-mix(in srgb, var(--muted) 72%, transparent);
    font-size: 15px;
    line-height: 1;
    text-align: center;
    transition: color .15s ease, transform .15s ease;
  }

  .tool-card[open] .tool-chevron { transform: rotate(90deg); }
  .tool-card > summary:hover .tool-chevron { color: var(--accent); }

  .activity-indicator {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 52%, transparent);
  }

  .activity-indicator.running {
    background: var(--yellow);
    box-shadow: 0 0 8px color-mix(in srgb, var(--yellow) 52%, transparent);
    animation: activity-glow 1.4s ease-in-out infinite;
  }

  .activity-indicator.ok {
    background: var(--green);
    box-shadow: none;
  }

  .activity-indicator.err {
    background: var(--red);
    box-shadow: 0 0 8px color-mix(in srgb, var(--red) 42%, transparent);
  }

  .tname {
    flex: none;
    color: color-mix(in srgb, var(--accent) 80%, var(--text));
    font: 650 11.5px/1.2 var(--mono);
  }

  .targ {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--muted);
    font: 10.5px/1.25 var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    margin-left: auto;
    flex: none;
    color: var(--green);
    font-size: 9.5px;
    font-weight: 680;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .status.running { color: var(--yellow); }
  .status.err { color: var(--red); }

  .tool-card > .body {
    min-width: 0;
    margin: 5px 0 7px 8px;
    padding: 7px 0 7px 15px;
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    background: transparent;
    color: var(--muted);
  }

  .body pre,
  .diff {
    max-width: 100%;
    max-height: 350px;
    margin: 0;
    overflow: auto;
    overscroll-behavior: contain;
    font: 12px/1.5 var(--mono);
  }

  .body pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .args-pre { color: var(--muted); }
  .result-pre { color: color-mix(in srgb, var(--text) 88%, var(--muted)); }

  .args-pre + .result-pre,
  .diff + .result-pre {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
  }

  .diff-line {
    min-width: max-content;
    padding: 1px 5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff-del {
    background: color-mix(in srgb, var(--red) 9%, transparent);
    color: var(--red);
  }

  .diff-add {
    background: color-mix(in srgb, var(--green) 9%, transparent);
    color: var(--green);
  }

  .diff-hdr {
    margin-top: 6px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: .04em;
  }

  .diff-hdr:first-child { margin-top: 0; }

  .empty-detail {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    font-style: italic;
  }

  @keyframes activity-glow {
    0%, 100% { opacity: .58; transform: scale(.85); }
    50% { opacity: 1; transform: scale(1.12); }
  }

  @media (max-width: 760px) {
    .tool-card > summary {
      min-height: 40px;
      gap: 7px;
    }

    .tool-card > .body {
      margin-left: 5px;
      padding-left: 13px;
    }

    .body pre,
    .diff { max-height: 55vh; }
  }
</style>
