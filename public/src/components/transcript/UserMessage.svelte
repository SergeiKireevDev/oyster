<script>
  import PermalinkButton from "./PermalinkButton.svelte";
  import CopyMessageButton from "./CopyMessageButton.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";
  import { checkpointMarker } from "../../stores/checkpointMarker.js";
  import { checkpointRestores } from "../../stores/checkpointRestores.js";

  let { text = "", onPermalink = () => {}, onCopy = () => {}, onCheckpoint = () => {}, onRollback = () => {}, onRoot = () => {} } = $props();

  let root = $state();
  const iface = $derived(text.match(/^Opening interface: (.*)\n/));
  const interfaceTitle = $derived(iface ? iface[1] : "");
  const interfaceBody = $derived(iface ? text.slice(iface[0].length) : "");
  const restore = $derived($checkpointRestores.find((item) => item.target === root));
  $effect(() => { if (root) onRoot(root); });
</script>

{#if iface}
  <details class="block tool" class:ckpt-frozen={!!restore} data-role="user" bind:this={root}>
    <summary><span class="tname">opening interface</span><span class="targ">{interfaceTitle}</span></summary>
    <div class="body"><pre>{interfaceBody}</pre></div>
    {#if $checkpointMarker.target === root}
      <CheckpointButton {onCheckpoint} busy={$checkpointMarker.busy} />
    {/if}
    {#if restore}
      <CheckpointRestoreButton {restore} {onRollback} />
    {/if}
  </details>
{:else}
  <div class="msg user" class:ckpt-frozen={!!restore} data-role="user" bind:this={root}>
    {text}<PermalinkButton target={root} {onPermalink} />
    <CopyMessageButton {text} {onCopy} />
    {#if $checkpointMarker.target === root}
      <CheckpointButton {onCheckpoint} busy={$checkpointMarker.busy} />
    {/if}
    {#if restore}
      <CheckpointRestoreButton {restore} {onRollback} />
    {/if}
  </div>
{/if}
