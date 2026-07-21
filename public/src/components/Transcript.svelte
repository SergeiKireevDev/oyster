<script>
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { transcriptItems } from "../stores/transcriptItems.js";
</script>

<div id="messages">
  {#each $transcriptItems as item (item.id)}
    {#if item.kind === "user"}
      <UserMessage
        text={item.text}
        onPermalink={item.onPermalink}
        onCheckpoint={item.onCheckpoint}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
      />
    {:else}
      <AssistantMessage
        assistantStore={item.assistantStore}
        role={item.role}
        onPermalink={item.onPermalink}
        onCheckpoint={item.onCheckpoint}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
      />
    {/if}
  {/each}
</div>
