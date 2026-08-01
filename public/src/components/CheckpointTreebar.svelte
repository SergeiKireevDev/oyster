<script>
  import CheckpointTreeNode from "./CheckpointTreeNode.svelte";
  import { checkpointTree } from "../stores/checkpointTree.js";
</script>

<aside id="treebar" class="workspace-aux-sidebar" aria-labelledby="checkpoint-tree-heading">
  <h2 id="checkpoint-tree-heading" class="side-head">Checkpoints &amp; forks</h2>
  <div id="treeView" aria-busy={$checkpointTree.loading}>
    {#if $checkpointTree.loading}
      <div class="checkpoint-tree-state checkpoint-tree-loading sidebar-loading" role="status" aria-atomic="true">
        <span class="spin" aria-hidden="true"></span>
        <span>Loading tree…</span>
      </div>
    {:else if $checkpointTree.error}
      <div class="checkpoint-tree-state checkpoint-tree-error" role="alert" aria-atomic="true">{$checkpointTree.error}</div>
    {:else if $checkpointTree.empty}
      <div class="checkpoint-tree-state checkpoint-tree-empty" role="status" aria-atomic="true">{$checkpointTree.empty}</div>
    {:else if $checkpointTree.root}
      <CheckpointTreeNode
        node={$checkpointTree.root}
        currentSessionId={$checkpointTree.currentSessionId}
        runners={$checkpointTree.runners}
        capabilities={$checkpointTree.capabilities}
      />
    {/if}
  </div>
</aside>

<style>
  .side-head {
    margin: 0;
  }

  #treeView {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
  }

  .checkpoint-tree-state {
    min-width: 0;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--panel-2) 62%, transparent);
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .checkpoint-tree-loading {
    min-height: 38px;
    margin: 0;
  }

  .checkpoint-tree-error {
    border-color: color-mix(in srgb, var(--red) 36%, var(--border));
    background: color-mix(in srgb, var(--red) 7%, var(--panel));
    color: var(--red);
  }

  @media (max-width: 760px) {
    #treebar {
      padding-bottom: calc(14px + env(safe-area-inset-bottom));
    }

    .checkpoint-tree-state {
      min-height: 40px;
      padding: 11px;
    }
  }
</style>
