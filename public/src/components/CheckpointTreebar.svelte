<script>
  import CheckpointTreeNode from "./CheckpointTreeNode.svelte";
  import { checkpointTree } from "../stores/checkpointTree.js";
</script>

<aside id="treebar" aria-labelledby="checkpoint-tree-heading">
  <div id="checkpoint-tree-heading" class="side-head" role="heading" aria-level="2">Checkpoints &amp; forks</div>
  <div id="treeView" aria-busy={$checkpointTree.loading}>
    {#if $checkpointTree.loading}
      <div class="sidebar-loading" role="status" aria-atomic="true">
        <span class="spin" aria-hidden="true"></span>
        <span>loading tree…</span>
      </div>
    {:else if $checkpointTree.error}
      <div class="t-empty" role="alert" aria-atomic="true">{$checkpointTree.error}</div>
    {:else if $checkpointTree.empty}
      <div class="t-empty" role="status" aria-atomic="true">{$checkpointTree.empty}</div>
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
