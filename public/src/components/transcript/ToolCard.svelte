<script>
  import { summarizeToolArgs } from "../../lib/messageUtils.js";

  let { cardStore } = $props();
  let root = $state();
  const card = $derived($cardStore);
  const name = $derived(card.toolCall?.name ?? "");
  const args = $derived(card.toolCall?.arguments);
  const argSummary = $derived(summarizeToolArgs(name, args));
  const isEdit = $derived(name.toLowerCase() === "edit" && args && Array.isArray(args.edits));
  const statusText = $derived(card.status === "running" ? "⏳" : card.status === "error" ? "✗" : "✓");
  const statusClass = $derived(card.status === "running" ? "running" : card.status === "error" ? "err" : "ok");
  const resultText = $derived((card.resultText ?? "").length > 20000
    ? `${(card.resultText ?? "").slice(0, 20000)}\n… (truncated)`
    : (card.resultText ?? ""));
  const argsText = $derived(JSON.stringify(args, null, 2) ?? "");

  function diffLines(edits = []) {
    const lines = [];
    edits.forEach((edit, index) => {
      if (edits.length > 1) lines.push({ className: "diff-hdr", text: `edit ${index + 1}:` });
      for (const line of String(edit.oldText ?? "").split("\n")) lines.push({ className: "diff-del", text: `- ${line}` });
      for (const line of String(edit.newText ?? "").split("\n")) lines.push({ className: "diff-add", text: `+ ${line}` });
    });
    return lines;
  }
</script>

<details class="block tool" bind:this={root}>
  <summary><span class="tname">{name}</span><span class="targ">{argSummary}</span><span class={`status ${statusClass}`}>{statusText}</span></summary>
  <div class="body">
    <pre class="args-pre">{isEdit ? "" : argsText}</pre>
    {#if isEdit}
      <div class="diff">
        {#each diffLines(args.edits) as line}
          <div class={`diff-line ${line.className}`}>{line.text}</div>
        {/each}
      </div>
    {/if}
    <pre class="result-pre">{resultText}</pre>
  </div>
</details>
