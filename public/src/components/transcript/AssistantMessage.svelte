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

<style>
  .assistant-entry {
    display: flex;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  .assistant-entry.empty { display: none; }

  .assistant-part {
    align-self: stretch;
    width: 100%;
    max-width: 840px;
    min-width: 0;
    padding: 0 4px;
    color: var(--text);
    font-size: 14.5px;
    line-height: 1.62;
    overflow-wrap: anywhere;
  }

  .assistant-part:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .assistant-part.ckpt-frozen {
    padding-inline-start: 12px;
    border-inline-start: 3px solid color-mix(in srgb, var(--accent) 52%, transparent);
    border-radius: 3px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--accent) 7%, transparent),
      transparent 45%
    );
  }

  .error-msg {
    display: flex;
    gap: 8px;
    padding: 9px 12px;
    border: 1px solid color-mix(in srgb, var(--red) 58%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--red) 7%, transparent);
    color: var(--red);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .error-msg::before {
    content: "!";
    display: grid;
    width: 18px;
    height: 18px;
    flex: none;
    place-items: center;
    margin-top: 1px;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  @media (max-width: 760px) {
    .assistant-part {
      font-size: 13.75px;
      line-height: 1.52;
    }
  }
</style>
