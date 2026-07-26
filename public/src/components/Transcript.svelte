<script>
  import { onMount } from "svelte";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import CompactionMarker from "./transcript/CompactionMarker.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { appSession } from "../stores/appSession.js";
  import { transcriptItems } from "../stores/transcriptItems.js";
  import { formatWorkDuration, latestTranscriptWorkPeriod } from "../lib/workDuration.js";

  let now = Date.now();
  let workPeriod;

  $: workPeriod = latestTranscriptWorkPeriod($transcriptItems);

  onMount(() => {
    const timer = setInterval(() => { if ($appSession.busy) now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });
</script>

<div id="messages">
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
    {:else if item.kind === "compaction"}
      <CompactionMarker tokensBefore={item.tokensBefore} />
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
