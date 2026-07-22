<script>
  import { onMount } from "svelte";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { appSession } from "../stores/appSession.js";
  import { transcriptItems } from "../stores/transcriptItems.js";
  import { formatWorkDuration, latestTranscriptWorkPeriod } from "../lib/workDuration.js";

  let messages;
  let now = Date.now();
  let workPeriod;

  $: workPeriod = latestTranscriptWorkPeriod($transcriptItems);

  // Late-loading markdown content can grow the transcript after render. Keep
  // a reader who was already at the bottom pinned there.
  onMount(() => {
    const scroller = messages.parentElement;
    const onLoad = () => {
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    };
    const timer = setInterval(() => { if ($appSession.busy) now = Date.now(); }, 1000);
    messages.addEventListener("load", onLoad, true);
    return () => {
      clearInterval(timer);
      messages.removeEventListener("load", onLoad, true);
    };
  });
</script>

<div id="messages" bind:this={messages}>
  {#each $transcriptItems as item (item.id)}
    {#if item.kind === "user"}
      <UserMessage
        text={item.text}
        onPermalink={item.onPermalink}
        onCopy={item.onCopy}
        onCheckpoint={item.onCheckpoint}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
      />
    {:else}
      <AssistantMessage
        assistantStore={item.assistantStore}
        role={item.role}
        onPermalink={item.onPermalink}
        onCopy={item.onCopy}
        onCheckpoint={item.onCheckpoint}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
      />
    {/if}
  {/each}
  {#if workPeriod}
    <div class="work-duration" aria-live="off">
      {#if $appSession.busy}<span class="spin" aria-hidden="true"></span>{/if}
      <span>worked for {formatWorkDuration(($appSession.busy ? now : workPeriod.endedAt) - workPeriod.startedAt)}</span>
    </div>
  {/if}
</div>
