<script>
  import { writable } from "svelte/store";
  import ActivityStack from "./ActivityStack.svelte";
  import AssistantPartActions from "./AssistantPartActions.svelte";
  import SanitizedMarkdown from "../SanitizedMarkdown.svelte";
  import { checkpointMarker } from "../../stores/checkpointMarker.js";
  import { checkpointRestores } from "../../stores/checkpointRestores.js";

  let { assistantStore = writable({ blocks: [], copyText: "", errorMessage: "" }), activityBlocks = [], role = "assistant", activityActive = false, activityUnsettled = false, onPermalink = () => {}, onCopy = () => {}, onCheckpoint = () => {}, onRollback = () => {}, onRoot = () => {} } = $props();
  let root = $state();
  const data = $derived($assistantStore);
  const displayBlocks = $derived(arrangeActivity(data.blocks, activityBlocks));
  const restore = $derived($checkpointRestores.find((item) => item.target === root));
  $effect(() => { if (root) onRoot(root); });

  function selectOnFirstTouch(event) {
    if (event.pointerType !== "touch" || event.currentTarget.matches(":focus-within")) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
  }

  function thinkingPreview(text, maxLength = 150) {
    const compact = String(text ?? "").replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `…${compact.slice(-maxLength).trimStart()}`;
  }

  function arrangeActivity(blocks = [], activities = []) {
    const visible = blocks.filter((block) => block.type !== "thinking" && block.type !== "toolCall");
    if (!activities.length) return visible;

    visible.unshift({
      type: "activityStack",
      key: `activity:${activities[0].key ?? activities[0].id ?? "current"}`,
      blocks: activities,
    });
    return visible;
  }
</script>

<div class="assistant-entry" class:empty={displayBlocks.length === 0 && !data.errorMessage} data-role={role} bind:this={root}>
  {#each displayBlocks as block, index (`${block.type}:${index}:${block.key ?? ""}`)}
    <div class="msg assistant assistant-part" class:ckpt-frozen={!!restore} data-assistant-part={block.type} tabindex="-1" onpointerdowncapture={selectOnFirstTouch}>
      {#if block.type === "text"}
        <SanitizedMarkdown className="md" source={block.text} />
      {:else if block.type === "activityStack"}
        <ActivityStack blocks={block.blocks} active={activityActive} unsettled={activityUnsettled} {thinkingPreview} />
      {/if}
      <AssistantPartActions
        target={root}
        copyText={block.type === "text" ? block.text : ""}
        copy={block.type === "text"}
        {onPermalink}
        {onCopy}
        {onCheckpoint}
        {onRollback}
        checkpoint={$checkpointMarker.target === root && index === displayBlocks.length - 1}
        checkpointBusy={$checkpointMarker.busy}
        restore={index === displayBlocks.length - 1 ? restore : null}
      />
    </div>
  {/each}
  {#if data.errorMessage}
    <div class="msg assistant assistant-part error-msg" class:ckpt-frozen={!!restore} data-assistant-part="error" tabindex="-1" onpointerdowncapture={selectOnFirstTouch}>
      {data.errorMessage}
      {#if displayBlocks.length === 0}
        <AssistantPartActions
          target={root}
          {onPermalink}
          {onCheckpoint}
          {onRollback}
          checkpoint={$checkpointMarker.target === root}
          checkpointBusy={$checkpointMarker.busy}
          {restore}
        />
      {/if}
    </div>
  {/if}
</div>
