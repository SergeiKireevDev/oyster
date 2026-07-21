<script>
  import { transcript } from "../stores/transcript.js";
</script>

<div id="messages">
  {#each $transcript.items as item (item.key)}
    <!-- Transcript rendering migrates here incrementally in Step 9. -->
  {/each}
</div>
