<script>
  import PermalinkButton from "./PermalinkButton.svelte";
  import CopyMessageButton from "./CopyMessageButton.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";

  /** @typedef {{ hash: string } & Record<string, unknown>} Checkpoint */
  /** @typedef {{ busy?: boolean, checkpoint: Checkpoint }} RestoreState */
  /**
   * @typedef {object} Props
   * @property {HTMLElement | null} [target]
   * @property {string} [copyText]
   * @property {boolean} [copy]
   * @property {(target: HTMLElement | null) => void} [onPermalink]
   * @property {(text: string) => void} [onCopy]
   * @property {() => void} [onCheckpoint]
   * @property {(checkpoint: Checkpoint) => void} [onRollback]
   * @property {boolean} [checkpoint]
   * @property {boolean} [checkpointBusy]
   * @property {RestoreState | null} [restore]
   */

  /** @type {Props} */
  let {
    target = null,
    copyText = "",
    copy: showCopy = false,
    onPermalink = () => {},
    onCopy = () => {},
    onCheckpoint = () => {},
    onRollback = () => {},
    checkpoint: showCheckpoint = false,
    checkpointBusy = false,
    restore: restoreState = null,
  } = $props();
</script>

<PermalinkButton {target} {onPermalink} />
{#if showCopy}
  <CopyMessageButton text={copyText} {onCopy} />
{/if}
{#if showCheckpoint}
  <CheckpointButton {onCheckpoint} busy={checkpointBusy} />
{/if}
{#if restoreState}
  <CheckpointRestoreButton restore={restoreState} {onRollback} />
{/if}
