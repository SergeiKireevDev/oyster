<script>
  import { onMount } from "svelte";
  import { derived } from "svelte/store";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import CompactionMarker from "./transcript/CompactionMarker.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { appSession } from "../stores/appSession.js";
  import { checkpointMarker } from "../stores/checkpointMarker.js";
  import { checkpointRestores } from "../stores/checkpointRestores.js";
  import { transcriptItems } from "../stores/transcriptItems.js";
  import { formatWorkDuration, latestTranscriptWorkPeriod } from "../lib/workDuration.js";
  import { subscribeStoreGroup } from "../lib/storeGroup.js";

  const isTurnBoundary = (item) => item.kind === "user" || item.kind === "compaction";
  const isActivityBlock = (block) => block.type === "thinking" || block.type === "toolCall";

  const turnActivityGroups = derived(transcriptItems, (items, set) => {
    const assistantItems = items.filter((item) => !isTurnBoundary(item) && item.assistantStore);
    return subscribeStoreGroup(assistantItems.map((item) => item.assistantStore), (messages) => {
      const messageById = new Map(assistantItems.map((item, index) => [item.id, messages[index]]));
      const groups = new Map();
      let turnActivities = [];
      let turnAnchorId = null;

      const commitTurn = () => {
        if (turnAnchorId && turnActivities.length) groups.set(turnAnchorId, turnActivities);
        turnActivities = [];
        turnAnchorId = null;
      };

      for (const item of items) {
        if (isTurnBoundary(item)) {
          commitTurn();
          continue;
        }
        const message = messageById.get(item.id);
        if (!message) continue;
        turnAnchorId ??= item.id;
        turnActivities.push(...(message.blocks ?? []).filter(isActivityBlock));
      }
      commitTurn();
      set(groups);
    });
  }, new Map());

  const latestTurnActivityId = derived(
    [transcriptItems, turnActivityGroups],
    ([items, groups]) => {
      let boundary = -1;
      for (let index = items.length - 1; index >= 0; index--) {
        if (isTurnBoundary(items[index])) {
          boundary = index;
          break;
        }
      }
      for (let index = boundary + 1; index < items.length; index++) {
        if (groups.has(items[index].id)) return items[index].id;
      }
      return null;
    },
  );

  let now = Date.now();
  let workPeriod;
  let workClock;

  const isCurrentTurnActivity = (item) => $appSession.busy && item.id === $latestTurnActivityId;

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
        checkpoint={$checkpointMarker}
        restores={$checkpointRestores}
      />
    {:else if item.kind === "compaction"}
      <CompactionMarker tokensBefore={item.tokensBefore} />
    {:else}
      {@const activityCurrent = isCurrentTurnActivity(item)}
      <AssistantMessage
        assistantStore={item.assistantStore}
        role={item.role}
        onPermalink={item.onPermalink}
        onCopy={item.onCopy}
        onCheckpoint={item.onCheckpoint}
        onRollback={item.onRollback}
        onRoot={item.setRoot}
        checkpoint={$checkpointMarker}
        restores={$checkpointRestores}
        activityActive={activityCurrent}
        activityUnsettled={activityCurrent}
        activityBlocks={$turnActivityGroups.get(item.id) ?? []}
        activityKey={item.id}
      />
    {/if}
  {/each}
  {#if workPeriod}
    <div class="work-duration" aria-live="off">
      {#if $appSession.busy && !$appSession.compacting}<span class="spin" aria-hidden="true"></span>{/if}
      <span>worked for {workDuration}</span>
    </div>
  {/if}
  {#if $appSession.compacting}
    <div class="compaction-status" role="status" aria-live="polite" aria-atomic="true">
      <span class="spin" aria-hidden="true"></span>
      <span>Compacting context…</span>
    </div>
  {/if}
</div>
