<script>
  import AppIcon from "./AppIcon.svelte";
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

<div class="checkpoint-tree-node">
  <button
    type="button"
    class="t-session"
    class:current={isCurrent}
    class:fork={isFork}
    class:busy={live?.busy}
    aria-current={isCurrent ? "true" : undefined}
    aria-label={sessionLabel}
    title={node.sessionKey ?? node.path ?? node.id}
    onclick={() => openCheckpointTreeSession(node)}
  >
    <span class="t-session-icon" aria-hidden="true"><AppIcon name="fork" size={14} /></span>
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
          <span class="t-ckpt-icon" aria-hidden="true">🧊</span>
          <span class="t-hash">{row.checkpoint.hash}</span>
          {#if row.message}<span class="t-msg">{row.message}</span>{/if}
          {#if row.time}<time class="t-time" datetime={row.checkpoint.timestamp}>{row.time}</time>{/if}
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

<style>
  .checkpoint-tree-node {
    min-width: 0;
  }

  .t-session,
  .t-ckpt {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 140ms, background 140ms, color 140ms;
  }

  .t-session {
    min-height: 34px;
    gap: 7px;
    padding: 5px 7px;
    border-radius: 9px;
    font-weight: 560;
  }

  .t-session:hover {
    border-color: color-mix(in srgb, var(--border) 74%, transparent);
    background: var(--surface-hover);
  }

  .t-session.current {
    border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
    background: color-mix(in srgb, var(--accent-dim) 48%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
    color: var(--accent);
    font-weight: 650;
  }

  .t-session-icon,
  .t-ckpt-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
  }

  .t-session-icon {
    color: var(--muted);
  }

  .t-session.fork .t-session-icon {
    color: var(--accent);
  }

  .t-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border: 1px solid color-mix(in srgb, var(--green) 54%, var(--panel));
    border-radius: 50%;
    background: var(--green);
  }

  .t-dot.busy {
    border-color: var(--accent);
    background: transparent;
    animation: checkpoint-tree-pulse 1.2s ease-in-out infinite;
  }

  .t-kids,
  .t-forks {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
    margin-left: 10px;
    padding-left: 10px;
    border-left: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  }

  .t-kids {
    margin-top: 2px;
  }

  .t-forks {
    margin-left: 8px;
    padding-left: 8px;
    border-left-style: dashed;
  }

  .t-ckpt {
    min-height: 31px;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 8px;
    color: var(--muted);
  }

  .t-ckpt:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
    background: color-mix(in srgb, var(--accent-dim) 28%, transparent);
    color: var(--text);
  }

  .t-ckpt:disabled {
    opacity: .45;
    cursor: not-allowed;
  }

  .t-ckpt-icon {
    width: 14px;
    font-size: 11px;
    filter: saturate(.72);
  }

  .t-hash {
    max-width: 9ch;
    flex: none;
    overflow: hidden;
    color: var(--text);
    font: 10.5px/1.2 var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-msg {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-time {
    margin-left: auto;
    flex: none;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  @keyframes checkpoint-tree-pulse {
    50% {
      background: var(--accent);
      transform: scale(.72);
    }
  }

  @media (max-width: 760px) {
    .t-session,
    .t-ckpt {
      min-height: 40px;
    }

    .t-kids,
    .t-forks {
      margin-left: 7px;
      padding-left: 7px;
    }
  }

  @media (max-width: 520px) {
    .t-time {
      display: none;
    }
  }
</style>
