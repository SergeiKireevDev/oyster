<script>
  import ToolCard from "./ToolCard.svelte";
  import { subscribeStoreGroup } from "../../lib/storeGroup.js";

  let { blocks = [] } = $props();

  let cards = $state([]);
  $effect(() => subscribeStoreGroup(
    blocks.map((block) => block.cardStore),
    (values) => { cards = values; },
  ));
  const running = $derived(cards.filter((card) => card.status === "running").length);
  const failed = $derived(cards.filter((card) => card.status === "error").length);
  const toolSummary = $derived(summarizeTools(cards));

  function summarizeTools(items) {
    const counts = new Map();
    for (const item of items) {
      const name = item.toolCall?.name || "tool";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
      .join(" · ");
  }
</script>

<details class="block tool-group" open={running > 0 || failed > 0}>
  <summary>
    <span class="tool-group-count">{blocks.length} tool calls</span>
    <span class="tool-group-preview">{toolSummary}</span>
    <span class:running={running > 0} class:error={failed > 0} class="tool-group-status">
      {failed > 0 ? `${failed} failed` : running > 0 ? `${running} running` : "done"}
    </span>
  </summary>
  <div class="tool-group-body">
    {#each blocks as block, index (`${block.key ?? block.id ?? "tool"}:${index}`)}
      <ToolCard cardStore={block.cardStore} />
    {/each}
  </div>
</details>
