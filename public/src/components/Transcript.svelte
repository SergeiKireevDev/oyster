<script>
  import { onMount } from "svelte";
  import { derived } from "svelte/store";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import CompactionMarker from "./transcript/CompactionMarker.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { appSession } from "../stores/appSession.js";
  import { checkpointRestores } from "../stores/checkpointRestores.js";
  import { transcriptItems } from "../stores/transcriptItems.js";
  import { interleaveTranscriptActivity } from "../lib/transcriptActivity.js";
  import { formatWorkDuration, latestTranscriptWorkPeriod } from "../lib/workDuration.js";
  import { subscribeStoreGroup } from "../lib/storeGroup.js";

  const transcriptActivityLayout = derived(transcriptItems, (items, set) => {
    const assistantItems = items.filter((item) => item.assistantStore);
    return subscribeStoreGroup(assistantItems.map((item) => item.assistantStore), (messages) => {
      const messageById = new Map(assistantItems.map((item, index) => [item.id, messages[index]]));
      set(interleaveTranscriptActivity(items, messageById));
    });
  }, { blocksById: new Map(), currentActivityKey: null });

  let now = Date.now();
  let workPeriod;
  let workClock;

  function stopWorkClock() {
    if (workClock === undefined) return;
    clearInterval(workClock);
    workClock = undefined;
  }

  $: workPeriod = latestTranscriptWorkPeriod($transcriptItems, $appSession.workTimerResetAt);
  $: workDuration = workPeriod
    ? formatWorkDuration(($appSession.busy ? now : workPeriod.endedAt) - workPeriod.startedAt)
    : "";

  onMount(() => {
    let wasBusy;
    const unsubscribe = appSession.subscribe(({ busy }) => {
      if (busy === wasBusy) return;
      wasBusy = busy;
      stopWorkClock();
      if (!busy) return;
      now = Date.now();
      workClock = setInterval(() => { now = Date.now(); }, 1000);
    });

    return () => {
      unsubscribe();
      stopWorkClock();
    };
  });
</script>

<div id="messages" class="transcript" aria-busy={$appSession.busy || $appSession.compacting}>
  {#each $transcriptItems as item (item.id)}
    {#if item.kind === "user"}
      <UserMessage
        text={item.text}
        onPermalink={item.onPermalink}
        onCopy={item.onCopy}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
        restores={$checkpointRestores}
      />
    {:else if item.kind === "compaction"}
      <CompactionMarker tokensBefore={item.tokensBefore} />
    {:else}
      <AssistantMessage
        assistantStore={item.assistantStore}
        role={item.role}
        onPermalink={item.onPermalink}
        onCopy={item.onCopy}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
        restores={$checkpointRestores}
        displayBlocks={$transcriptActivityLayout.blocksById.get(item.id) ?? []}
        currentActivityKey={$appSession.busy ? $transcriptActivityLayout.currentActivityKey : null}
      />
    {/if}
  {/each}
  {#if workPeriod}
    <div class="transcript-status work-duration" class:active={$appSession.busy} aria-live="off">
      {#if $appSession.busy && !$appSession.compacting}<span class="spin" aria-hidden="true"></span>{/if}
      <span>worked for {workDuration}</span>
    </div>
  {/if}
  {#if $appSession.compacting}
    <div class="transcript-status compaction-status" role="status" aria-live="polite" aria-atomic="true">
      <span class="spin" aria-hidden="true"></span>
      <span>Compacting context…</span>
    </div>
  {/if}
</div>

<style>
  .transcript {
    display: flex;
    width: 100%;
    max-width: 960px;
    min-width: 0;
    margin: 0 auto;
    padding: 32px 40px 22px;
    flex-direction: column;
    gap: 4px;
  }

  .transcript-status {
    display: flex;
    width: fit-content;
    max-width: 100%;
    min-height: 26px;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 560;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .work-duration {
    margin: 3px 4px 0;
    padding: 3px 0;
    font-variant-numeric: tabular-nums;
  }

  .work-duration.active { color: color-mix(in srgb, var(--accent) 62%, var(--muted)); }

  .transcript-status .spin {
    width: 10px;
    height: 10px;
    flex: none;
    border-width: 1.5px;
  }

  .work-duration .spin { border-top-color: currentColor; }

  .compaction-status {
    margin-top: 5px;
    padding: 5px 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: color-mix(in srgb, var(--accent) 68%, var(--text));
  }

  .compaction-status .spin { border-top-color: var(--accent); }

  @media (max-width: 1080px) and (min-width: 761px) {
    .transcript { padding-inline: 24px; }
  }

  @media (max-width: 760px) {
    .transcript {
      padding:
        17px
        max(16px, env(safe-area-inset-right))
        12px
        max(16px, env(safe-area-inset-left));
    }
  }
</style>
