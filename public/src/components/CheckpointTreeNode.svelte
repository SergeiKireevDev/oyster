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
  // Recursive instances share this index so a large tree scans the runner list only once.
  export let liveRunnerIndex = null;

  function indexLiveRunners(items) {
    const index = new Map();
    for (const runner of items) {
      if (!runner.alive) continue;
      const identity = runnerSessionIdentity(runner);
      if (identity != null && !index.has(identity)) index.set(identity, runner);
    }
    return index;
  }

  function checkpointMessage(checkpoint) {
    const text = (checkpoint.message ?? "").replace(/^checkpoint:?\s*/i, "").trim();
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? "" : text;
  }

  function checkpointTime(checkpoint) {
    const date = new Date(checkpoint.timestamp ?? NaN);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function childLayout(checkpoints, children) {
    const rows = checkpoints.map((checkpoint, index) => ({
      checkpoint,
      forks: [],
      key: `${checkpoint.hash}:${checkpoint.anchorId ?? checkpoint.timestamp ?? index}`,
      message: checkpointMessage(checkpoint),
      time: checkpointTime(checkpoint),
    }));
    const rowByHash = new Map();
    for (const row of rows) {
      if (!rowByHash.has(row.checkpoint.hash)) rowByHash.set(row.checkpoint.hash, row);
    }

    const unslotted = [];
    for (const child of children) {
      const row = rowByHash.get(child.forkedAtHash);
      if (row) row.forks.push(child);
      else unslotted.push(child);
    }
    return { rows, unslotted };
  }

  function checkpointTitle(row) {
    if (!capabilities.rollback) {
      return `Rollback unavailable: ${capabilities.reason ?? "exact-entry fork is unsupported"}`;
    }
    const summary = row.message || row.time || "Checkpoint";
    return `${summary}\nRoll the workdir back to ${row.checkpoint.hash} and fork the session there`;
  }

  function checkpointLabel(row) {
    if (!capabilities.rollback) return checkpointTitle(row);
    const details = [row.message, row.time].filter(Boolean).join(", ");
    return `Roll back to checkpoint ${row.checkpoint.hash}${details ? `, ${details}` : ""}`;
  }

  function rollbackFrom(checkpoint) {
    if (capabilities.rollback) rollbackCheckpoint({ hash: checkpoint.hash, sessionId: node.id });
  }

  $: isCurrent = node.id === currentSessionId;
  $: isFork = Boolean(node.parentId ?? node.parentSession);
  $: activeRunnerIndex = liveRunnerIndex ?? indexLiveRunners(runners);
  $: live = activeRunnerIndex.get(sessionIdentity(node));
  $: sessionName = node.name || node.id.slice(0, 8);
  $: sessionLabel = [
    sessionName,
    isFork ? "forked session" : "root session",
    isCurrent && "current session",
    live && (live.busy ? "working" : "live"),
  ].filter(Boolean).join(", ");
  $: layout = childLayout(node.checkpoints ?? [], node.children ?? []);
  $: hasChildren = layout.rows.length > 0 || layout.unslotted.length > 0;
</script>

<div>
  <button
    type="button"
    class="t-session"
    class:current={isCurrent}
    aria-current={isCurrent ? "true" : undefined}
    aria-label={sessionLabel}
    title={node.sessionKey ?? node.path ?? node.id}
    onclick={() => openCheckpointTreeSession(node)}
  >
    <span aria-hidden="true">{isFork ? "🌿" : "🌱"}</span>
    <span class="t-name">{sessionName}</span>
    {#if live}
      <span class="t-dot" class:busy={live.busy} aria-hidden="true"></span>
    {/if}
  </button>

  {#if hasChildren}
    <div class="t-kids">
      {#each layout.rows as row (row.key)}
        <button
          type="button"
          class="t-ckpt"
          aria-label={checkpointLabel(row)}
          title={checkpointTitle(row)}
          disabled={!capabilities.rollback}
          onclick={() => rollbackFrom(row.checkpoint)}
        >
          <span aria-hidden="true">🧊</span><span class="t-hash">{row.checkpoint.hash}</span><span class="t-msg">{row.message}</span><span class="t-time">{row.time}</span>
        </button>
        {#if row.forks.length}
          <div class="t-forks">
            {#each row.forks as child (child.id)}
              <svelte:self node={child} {currentSessionId} {runners} {capabilities} liveRunnerIndex={activeRunnerIndex} />
            {/each}
          </div>
        {/if}
      {/each}
      {#each layout.unslotted as child (child.id)}
        <svelte:self node={child} {currentSessionId} {runners} {capabilities} liveRunnerIndex={activeRunnerIndex} />
      {/each}
    </div>
  {/if}
</div>
