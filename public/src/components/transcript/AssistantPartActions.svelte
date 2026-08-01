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

<div class="assistant-part-actions" role="group" aria-label="Assistant message actions">
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
</div>

<style>
  .assistant-part-actions {
    position: absolute;
    z-index: 2;
    inset-block-start: -8px;
    inset-inline-end: 4px;
    display: flex;
    max-width: calc(100% - 8px);
    flex-direction: row-reverse;
    gap: 4px;
  }

  @media (max-width: 760px) {
    .assistant-part-actions {
      inset-block-start: -14px;
      gap: 2px;
    }
  }
</style>
