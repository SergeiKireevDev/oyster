<script>
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { CHECKPOINT_TREE_OPEN_ACTION, CHECKPOINT_TREE_ROLLBACK_ACTION } from "../runtime/uiActionNames.js";
  import { runnerSessionIdentity, sessionIdentity } from "../lib/sessionIdentity.js";

  const uiActions = getUiActionRegistry();
  const openCheckpointTreeSession = (node) => uiActions.invoke(CHECKPOINT_TREE_OPEN_ACTION, node);
  const rollbackCheckpoint = (checkpoint) => uiActions.invoke(CHECKPOINT_TREE_ROLLBACK_ACTION, checkpoint);

  export let node;
  export let currentSessionId = null;
  export let runners = [];
  export let capabilities = { rollback: true, reason: null };

  $: live = runners.find((runner) => runnerSessionIdentity(runner) === sessionIdentity(node) && runner.alive);

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

  function checkpointTitle(checkpoint) {
    return capabilities.rollback
      ? `${checkpoint.message ?? "checkpoint"}\nroll the workdir back to ${checkpoint.hash} and fork the session there`
      : `Rollback unavailable: ${capabilities.reason ?? "exact-entry fork is unsupported"}`;
  }

  function rollbackFrom(checkpoint) {
    if (capabilities.rollback) rollbackCheckpoint({ hash: checkpoint.hash, sessionId: node.id });
  }

  $: hasChildren = Boolean(node.checkpoints?.length || unslottedChildren.length);

  $: unslottedChildren = (node.children ?? []).filter((child) =>
    !(node.checkpoints ?? []).some((checkpoint) => checkpoint.hash === child.forkedAtHash)
  );
</script>

<div>
  <button
    type="button"
    class="t-session"
    class:current={node.id === currentSessionId}
    title={node.sessionKey ?? node.path ?? node.id}
    onclick={() => openCheckpointTreeSession(node)}
  >
    <span>{node.parentSession ? "🌿" : "🌱"}</span>
    <span class="t-name">{node.name || node.id.slice(0, 8)}</span>
    {#if live}
      <span class="t-dot" class:busy={live.busy} title={live.busy ? "working" : "live"}></span>
    {/if}
  </button>

  {#if hasChildren}
    <div class="t-kids">
      {#each node.checkpoints ?? [] as checkpoint (checkpoint.hash)}
        <button
          type="button"
          class="t-ckpt"
          title={checkpointTitle(checkpoint)}
          disabled={!capabilities.rollback}
          onclick={() => rollbackFrom(checkpoint)}
        >
          🧊<span class="t-hash">{checkpoint.hash}</span><span class="t-msg">{checkpointMessage(checkpoint)}</span><span class="t-time">{checkpointTime(checkpoint)}</span>
        </button>
        <div class="t-forks">
          {#each forkChildren(checkpoint.hash) as child (child.id)}
            <svelte:self node={child} {currentSessionId} {runners} {capabilities} />
          {/each}
        </div>
      {/each}
      {#each unslottedChildren as child (child.id)}
        <svelte:self node={child} {currentSessionId} {runners} {capabilities} />
      {/each}
    </div>
  {/if}
</div>
