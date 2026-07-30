<script>
  import { onMount } from "svelte";
  import { derived } from "svelte/store";
  import AssistantMessage from "./transcript/AssistantMessage.svelte";
  import CompactionMarker from "./transcript/CompactionMarker.svelte";
  import UserMessage from "./transcript/UserMessage.svelte";
  import { appSession } from "../stores/appSession.js";
  import { transcriptItems } from "../stores/transcriptItems.js";
  import { formatWorkDuration, latestTranscriptWorkPeriod } from "../lib/workDuration.js";
  import { subscribeStoreGroup } from "../lib/storeGroup.js";

  const turnActivityGroups = derived(transcriptItems, (items, set) => {
    const assistantItems = items.filter((item) => item.kind !== "user" && item.kind !== "compaction" && item.assistantStore);
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
        if (item.kind === "user" || item.kind === "compaction") {
          commitTurn();
          continue;
        }
        const message = messageById.get(item.id);
        if (!message) continue;
        turnAnchorId ??= item.id;
        turnActivities = [...turnActivities, ...(message.blocks ?? []).filter((block) => (
          block.type === "thinking" || block.type === "toolCall"
        ))];
      }
      commitTurn();
      set(groups);
    });
  }, new Map());
  const latestTurnActivityId = derived(
    [transcriptItems, turnActivityGroups],
    ([items, groups]) => {
      let boundary = -1;
      items.forEach((item, index) => {
        if (item.kind === "user" || item.kind === "compaction") boundary = index;
      });
      return items.slice(boundary + 1).find((item) => groups.has(item.id))?.id ?? null;
    },
  );

  let now = Date.now();
  let workPeriod;

  $: workPeriod = latestTranscriptWorkPeriod($transcriptItems, $appSession.workTimerResetAt);

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
        activityActive={$appSession.busy && item.id === $latestTurnActivityId}
        activityUnsettled={$appSession.busy && item.id === $latestTurnActivityId}
        activityBlocks={$turnActivityGroups.get(item.id) ?? []}
      />
    {/if}
  {/each}
  {#if workPeriod}
    <div class="work-duration" aria-live="off">
      {#if $appSession.busy && !$appSession.compacting}<span class="spin" aria-hidden="true"></span>{/if}
      <span>worked for {formatWorkDuration(($appSession.busy ? now : workPeriod.endedAt) - workPeriod.startedAt)}</span>
    </div>
  {/if}
  {#if $appSession.compacting}
    <div class="compaction-status" role="status" aria-live="polite">
      <span class="spin" aria-hidden="true"></span>
      <span>Compacting context…</span>
    </div>
  {/if}
</div>
