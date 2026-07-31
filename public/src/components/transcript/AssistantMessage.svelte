<script>
  import ActivityStack from "./ActivityStack.svelte";
  import AssistantPartActions from "./AssistantPartActions.svelte";
  import SanitizedMarkdown from "../SanitizedMarkdown.svelte";
  import { reportNode } from "../../lib/nodeReporter.js";

  let {
    assistantStore,
    activityBlocks = [],
    activityKey = "current",
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
  let root = $state(null);
  const data = $derived($assistantStore);
  const displayBlocks = $derived(arrangeActivity(data.blocks, activityBlocks, activityKey));
  const restore = $derived(restores.find((item) => item.target === root));
  const empty = $derived(displayBlocks.length === 0 && !data.errorMessage);

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

  function partActions(block, index) {
    const isText = block.type === "text";
    const isLast = index === displayBlocks.length - 1;
    return {
      copyText: isText ? block.text : "",
      copy: isText,
      checkpoint: isLast && checkpoint.target === root,
      restore: isLast ? restore : null,
    };
  }

  function arrangeActivity(blocks = [], activities = [], identity = "current") {
    const visible = [];
    if (activities.length) {
      visible.push({
        type: "activityStack",
        renderKey: `activity:${identity}`,
        blocks: activities,
      });
    }

    let textPosition = 0;
    for (const block of blocks) {
      if (block.type !== "text") continue;
      const renderKey = `text:${textPosition}`;
      textPosition += 1;
      if (!block.text) continue;
      visible.push({ ...block, renderKey });
    }
    return visible;
  }

  function blockIdentity(block) {
    return block.renderKey;
  }
</script>

<div class="assistant-entry" class:empty={empty} data-role={role} bind:this={root} use:reportNode={onRoot}>
  {#each displayBlocks as block, index (blockIdentity(block))}
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
    <div class="msg assistant assistant-part error-msg" class:ckpt-frozen={!!restore} data-assistant-part="error" role="alert" aria-atomic="true" tabindex="-1" onpointerdowncapture={selectOnFirstTouch}>
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
