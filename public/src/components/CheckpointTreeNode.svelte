<script>
  import { openCheckpointTreeSession, rollbackCheckpoint } from "../lib/legacyBridge.js";

  export let node;
  export let currentSessionId = null;
  export let runners = [];

  $: live = runners.find((runner) => runner.sessionFile === node.path && runner.alive);

  function checkpointMessage(checkpoint) {
    const text = (checkpoint.message ?? "").replace(/^checkpoint:?\s*/, "");
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? "" : text;
  }

  function checkpointTime(checkpoint) {
    const date = new Date(checkpoint.timestamp ?? NaN);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function forkChildren(hash) {
    return (node.children ?? []).filter((child) => child.forkedAtHash === hash);
  }

  $: unslottedChildren = (node.children ?? []).filter((child) =>
    !(node.checkpoints ?? []).some((checkpoint) => checkpoint.hash === child.forkedAtHash)
  );
</script>

<div>
  <div
    class="t-session"
    class:current={node.id === currentSessionId}
    title={node.path}
    role="button"
    tabindex="0"
    onclick={() => openCheckpointTreeSession(node)}
    onkeydown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCheckpointTreeSession(node);
      }
    }}
  >
    <span>{node.parentSession ? "🌿" : "🌱"}</span>
    <span class="t-name">{node.name || node.id.slice(0, 8)}</span>
    {#if live}
      <span class="t-dot" class:busy={live.busy} title={live.busy ? "working" : "live"}></span>
    {/if}
  </div>

  {#if (node.checkpoints?.length || 0) || unslottedChildren.length}
    <div class="t-kids">
      {#each node.checkpoints ?? [] as checkpoint}
        <div
          class="t-ckpt"
          title={`${checkpoint.message ?? "checkpoint"}\nroll the workdir back to ${checkpoint.hash} and fork the session there`}
          role="button"
          tabindex="0"
          onclick={(event) => rollbackCheckpoint({ hash: checkpoint.hash, sessionId: node.id }, event.currentTarget)}
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              rollbackCheckpoint({ hash: checkpoint.hash, sessionId: node.id }, event.currentTarget);
            }
          }}
        >
          🧊<span class="t-hash">{checkpoint.hash}</span><span class="t-msg">{checkpointMessage(checkpoint)}</span><span class="t-time">{checkpointTime(checkpoint)}</span>
        </div>
        <div class="t-forks">
          {#each forkChildren(checkpoint.hash) as child (child.id)}
            <svelte:self node={child} {currentSessionId} {runners} />
          {/each}
        </div>
      {/each}
      {#each unslottedChildren as child (child.id)}
        <svelte:self node={child} {currentSessionId} {runners} />
      {/each}
    </div>
  {/if}
</div>
