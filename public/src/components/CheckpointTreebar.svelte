<script>
  import CheckpointTreeNode from "./CheckpointTreeNode.svelte";
  import { checkpointTree } from "../stores/checkpointTree.js";
</script>

<aside id="treebar">
  <div class="side-head">Checkpoints &amp; forks</div>
  <div id="treeView">
    {#if $checkpointTree.loading}
      <div class="sidebar-loading"><span class="spin"></span> loading tree…</div>
    {:else if $checkpointTree.empty}
      <div class="t-empty">{$checkpointTree.empty}</div>
    {:else if $checkpointTree.error}
      <div class="t-empty">{$checkpointTree.error}</div>
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
