<script>
  import { writable } from "svelte/store";
  import ActivityStack from "./ActivityStack.svelte";
  import AssistantPartActions from "./AssistantPartActions.svelte";
  import SanitizedMarkdown from "../SanitizedMarkdown.svelte";
  import { reportNode } from "../../lib/nodeReporter.js";

  let {
    assistantStore = writable({ blocks: [], copyText: "", errorMessage: "" }),
    activityBlocks = [],
    role = "assistant",
    activityActive = false,
    activityUnsettled = false,
    checkpoint = { target: null, busy: false },
    restores = [],
    onPermalink = () => {},
    onCopy = () => {},
    onCheckpoint = () => {},
    onRollback = () => {},
    onRoot = () => {},
  } = $props();
  let root = $state();
  const data = $derived($assistantStore);
  const displayBlocks = $derived(arrangeActivity(data.blocks, activityBlocks));
  const restore = $derived(restores.find((item) => item.target === root));

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

  function isEmptyMessage() {
    return displayBlocks.length === 0 && !data.errorMessage;
  }

  function partActions(block, index) {
    const isText = block.type === "text";
    const isLast = index === displayBlocks.length - 1;
    return {
      copyText: isText ? block.text : "",
      copy: isText,
      checkpoint: checkpoint.target === root && isLast,
      restore: isLast ? restore : null,
    };
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

<div class="assistant-entry" class:empty={isEmptyMessage()} data-role={role} bind:this={root} use:reportNode={onRoot}>
  {#each displayBlocks as block, index (block)}
    {@const actions = partActions(block, index)}
    <div class="msg assistant assistant-part" class:ckpt-frozen={!!restore} data-assistant-part={block.type} tabindex="-1" onpointerdowncapture={selectOnFirstTouch}>
      {#if block.type === "text"}
        <SanitizedMarkdown className="md" source={block.text} />
      {:else if block.type === "activityStack"}
        <ActivityStack blocks={block.blocks} active={activityActive} unsettled={activityUnsettled} {thinkingPreview} />
      {/if}
      <AssistantPartActions
        target={root}
        copyText={actions.copyText}
        copy={actions.copy}
        {onPermalink}
        {onCopy}
        {onCheckpoint}
        {onRollback}
        checkpoint={actions.checkpoint}
        checkpointBusy={checkpoint.busy}
        restore={actions.restore}
      />
    </div>
  {/each}
  {#if data.errorMessage}
    <div class="msg assistant assistant-part error-msg" class:ckpt-frozen={!!restore} data-assistant-part="error" role="alert" tabindex="-1" onpointerdowncapture={selectOnFirstTouch}>
      {data.errorMessage}
      {#if displayBlocks.length === 0}
        <AssistantPartActions
          target={root}
          {onPermalink}
          {onCheckpoint}
          {onRollback}
          checkpoint={checkpoint.target === root}
          checkpointBusy={checkpoint.busy}
          {restore}
        />
      {/if}
    </div>
  {/if}
</div>
