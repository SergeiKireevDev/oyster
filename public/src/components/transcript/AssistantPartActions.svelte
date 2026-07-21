<script>
  import PermalinkButton from "./PermalinkButton.svelte";
  import CopyMessageButton from "./CopyMessageButton.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";

  let {
    target = null,
    copyText = "",
    copy = false,
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
{#if copy}
  <CopyMessageButton text={copyText} {onCopy} />
{/if}
{#if checkpoint}
  <CheckpointButton {onCheckpoint} busy={checkpointBusy} />
{/if}
{#if restore}
  <CheckpointRestoreButton {restore} {onRollback} />
{/if}
