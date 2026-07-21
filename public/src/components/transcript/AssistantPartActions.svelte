<script>
  import PermalinkButton from "./PermalinkButton.svelte";
  import CopyMessageButton from "./CopyMessageButton.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";

  let {
    target = null,
    copyText = "",
    onPermalink = () => {},
    onCopy = () => {},
    onCheckpoint = () => {},
    onRollback = () => {},
    checkpoint = false,
    checkpointBusy = false,
    restore = null,
  } = $props();
</script>

<PermalinkButton {target} {onPermalink} />
{#if copyText}
  <CopyMessageButton text={copyText} {onCopy} />
{/if}
{#if checkpoint}
  <CheckpointButton {onCheckpoint} busy={checkpointBusy} />
{/if}
{#if restore}
  <CheckpointRestoreButton {restore} {onRollback} />
{/if}
