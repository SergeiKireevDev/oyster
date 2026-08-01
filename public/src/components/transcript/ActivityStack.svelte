<script>
  import ToolCard from "./ToolCard.svelte";
  import { subscribeStoreGroup } from "../../lib/storeGroup.js";

  let { blocks = [], active = false, unsettled = false, thinkingPreview = (text) => text } = $props();

  const thinkingBlocks = $derived(blocks.filter((block) => block.type === "thinking"));
  const latestThinking = $derived(active ? thinkingBlocks.at(-1) : null);
  const headBlock = $derived(active ? blocks.at(-1) : null);
  const headTool = $derived(headBlock?.type === "toolCall" ? headBlock : null);
  const pastBlocks = $derived(blocks.filter((block) => (
    block !== latestThinking && block !== headTool
  )));
  const pastCardStores = $derived(pastBlocks
    .filter((block) => block.type === "toolCall")
    .map((block) => block.cardStore));
  let pastCards = $state([]);
  let historyOpen = $state(false);

  $effect(() => subscribeStoreGroup(pastCardStores, updatePastCards));

  function updatePastCards(values) {
    pastCards = values;
  }

  const failedCount = $derived(pastCards.reduce(
    (count, card) => count + (card?.status === "error" ? 1 : 0),
    0,
  ));
  const pastStepLabel = $derived(`${pastBlocks.length} past ${pastBlocks.length === 1 ? "step" : "steps"}`);
  const pastSummary = $derived(pastBlocks
    .slice(-4)
    .map((block) => block.type === "thinking" ? "thinking" : block.toolCall?.name || "tool")
    .join(" · "));
  const latestThinkingPreview = $derived(latestThinking ? thinkingPreview(latestThinking.text) : "");
  const historyToggleLabel = $derived(`${historyOpen ? "Hide" : "Show"} ${pastStepLabel}`);
</script>

<div class="activity-stack" role="group" aria-label="Assistant activity">
  {#if pastBlocks.length}
    <details class="activity-history" bind:open={historyOpen}>
      <summary title={historyToggleLabel}>
        <span class="activity-history-chevron" aria-hidden="true">›</span>
        <span>{pastStepLabel}</span>
        {#if pastSummary}<span class="activity-history-preview">{pastSummary}</span>{/if}
        {#if failedCount}<span class="activity-history-failed">{failedCount} failed</span>{/if}
      </summary>
      <div class="activity-history-body">
        {#each pastBlocks as block (block)}
          {#if block.type === "thinking"}
            {@const preview = thinkingPreview(block.text)}
            <details class="block thinking activity-step">
              <summary>
                <span class="activity-indicator" aria-hidden="true"></span>
                <span class="thinking-label">Thinking</span>
                {#if preview}<span class="thinking-preview">{preview}</span>{/if}
              </summary>
              <div class="body">{block.text}</div>
            </details>
          {:else}
            <ToolCard cardStore={block.cardStore} />
          {/if}
        {/each}
      </div>
    </details>
  {/if}

  {#if latestThinking}
    <details class="block thinking activity-step current-thinking">
      <summary>
        <span class="activity-indicator" class:glowing={unsettled} aria-hidden="true"></span>
        <span class="thinking-label">Thinking</span>
        {#if latestThinkingPreview}
          <span class="thinking-preview">{latestThinkingPreview}</span>
        {/if}
        {#if unsettled}<span class="activity-current-status">Active</span>{/if}
      </summary>
      <div class="body">{latestThinking.text}</div>
    </details>
  {/if}

  {#if headTool}
    <ToolCard cardStore={headTool.cardStore} />
  {/if}
</div>

<style>
  .activity-stack {
    display: grid;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    gap: 2px;
  }

  .activity-stack > details,
  .activity-history-body {
    min-width: 0;
    max-width: 100%;
  }

  .activity-history {
    margin: 0;
    color: var(--muted);
  }

  .activity-history > summary {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: 7px;
    padding: 2px 1px;
    overflow: hidden;
    color: var(--muted);
    cursor: pointer;
    list-style: none;
    font-size: 10.5px;
    font-weight: 560;
    user-select: none;
    transition: color .15s ease;
  }

  .activity-history > summary::-webkit-details-marker { display: none; }
  .activity-history > summary:hover { color: var(--text); }

  .activity-history-chevron {
    flex: none;
    color: color-mix(in srgb, var(--muted) 76%, var(--bg));
    font-size: 16px;
    line-height: 1;
    transition: transform .15s ease, color .15s ease;
  }

  .activity-history > summary:hover .activity-history-chevron { color: var(--accent); }
  .activity-history[open] .activity-history-chevron { transform: rotate(90deg); }

  .activity-history-preview {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--muted) 82%, var(--bg));
    font: 10px/1 var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-history-failed,
  .activity-current-status {
    flex: none;
    border: 1px solid currentColor;
    border-radius: 999px;
    line-height: 1;
  }

  .activity-history-failed {
    margin-left: auto;
    padding: 2px 5px;
    background: color-mix(in srgb, var(--red) 8%, transparent);
    color: var(--red);
    font-size: 9px;
    font-weight: 650;
  }

  .activity-history-body {
    display: grid;
    gap: 1px;
    margin: 2px 0 5px 3px;
    padding-left: 14px;
    border-left: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .activity-history-body details.thinking > summary { min-height: 26px; }

  .thinking .activity-indicator {
    background: color-mix(in srgb, var(--accent) 58%, var(--muted));
    box-shadow: none;
  }

  .current-thinking .activity-indicator.glowing {
    background: var(--accent);
    box-shadow:
      0 0 7px color-mix(in srgb, var(--accent) 78%, transparent),
      0 0 17px color-mix(in srgb, var(--accent) 38%, transparent);
    animation: activity-glow 1.6s ease-in-out infinite;
  }

  .thinking-label {
    flex: none;
    color: color-mix(in srgb, var(--accent) 58%, var(--text));
    font-weight: 620;
  }

  .thinking-preview {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-style: normal;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thinking-preview::before {
    content: "·";
    margin-right: 8px;
    color: color-mix(in srgb, var(--muted) 65%, transparent);
  }

  details.thinking[open] .thinking-preview { display: none; }

  .activity-current-status {
    margin-left: auto;
    padding: 2px 5px;
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    color: var(--accent);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  @keyframes activity-glow {
    0%, 100% { opacity: .58; transform: scale(.85); }
    50% { opacity: 1; transform: scale(1.12); }
  }

  @media (max-width: 760px) {
    .activity-history > summary,
    details.thinking > summary {
      min-height: 40px;
    }

    .activity-history-body {
      margin-left: 4px;
      padding-left: 12px;
    }
  }
</style>
