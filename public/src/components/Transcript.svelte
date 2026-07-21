<script>
  import { onMount } from "svelte";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { transcriptItems } from "../stores/transcriptItems.js";

  let messages;

  // Late-loading markdown content can grow the transcript after render. Keep
  // a reader who was already at the bottom pinned there.
  onMount(() => {
    const scroller = messages.parentElement;
    const onLoad = () => {
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    };
    messages.addEventListener("load", onLoad, true);
    return () => messages.removeEventListener("load", onLoad, true);
  });
</script>

<div id="messages" bind:this={messages}>
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
