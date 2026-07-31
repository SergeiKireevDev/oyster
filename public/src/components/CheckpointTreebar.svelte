<script>
  import CheckpointTreeNode from "./CheckpointTreeNode.svelte";
  import { checkpointTree } from "../stores/checkpointTree.js";
</script>

<aside id="treebar">
  <div class="side-head">Checkpoints &amp; forks</div>
  <div id="treeView">
    {#if $checkpointTree.loading}
      <div class="sidebar-loading" role="status"><span class="spin" aria-hidden="true"></span> loading tree…</div>
    {:else if $checkpointTree.empty}
      <div class="t-empty" role="status">{$checkpointTree.empty}</div>
    {:else if $checkpointTree.error}
      <div class="t-empty" role="alert">{$checkpointTree.error}</div>
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
