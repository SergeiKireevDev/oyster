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

<details class="block tool activity-step">
  <summary title={detailsLabel}>
    <span class={`activity-indicator ${statusClass}`} aria-hidden="true"></span>
    <span class="tname">{name || "Tool"}</span>
    <span class="targ">{argSummary}</span>
    <span class={`status ${statusClass}`} aria-live="off">{statusText}</span>
  </summary>
  <div class="body">
    {#if isEdit}
      <div class="diff" aria-label="Tool edits">
        {#each renderedDiffLines as line (line)}
          <div class={`diff-line ${line.className}`}>{line.text}</div>
        {/each}
      </div>
    {:else if argsText}
      <pre class="args-pre" aria-label="Tool arguments">{argsText}</pre>
    {/if}
    {#if resultText}
      <pre class="result-pre" aria-label="Tool result">{resultText}</pre>
    {/if}
  </div>
</details>
