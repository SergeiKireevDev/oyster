<script>
  export let content = "";
  export let format = "text";

  $: lines = String(content).split("\n");

  function diffLineKind(line) {
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) return "meta";
    if (line.startsWith("+")) return "added";
    if (line.startsWith("-")) return "removed";
    return "context";
  }
</script>

{#if format === "diff"}
  <pre class="pinned-monitor-output diff-output" aria-label="Monitoring diff output">{#each lines as line, index}<span class={`diff-line diff-${diffLineKind(line)}`}><i>{index + 1}</i><b>{line || " "}</b></span>{/each}</pre>
{:else}
  <pre class="pinned-monitor-output" aria-label="Monitoring output">{content}</pre>
{/if}
