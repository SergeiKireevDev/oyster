<script>
  /** @typedef {{ hash: string } & Record<string, unknown>} Checkpoint */
  /** @typedef {{ busy?: boolean, checkpoint: Checkpoint }} RestoreState */
  /**
   * @typedef {object} Props
   * @property {RestoreState} restore
   * @property {(checkpoint: Checkpoint) => void} [onRollback]
   */

  /** @type {Props} */
  let { restore, onRollback = () => {} } = $props();

  /** @param {MouseEvent} event */
  function handleClick(event) {
    event.stopPropagation();
    onRollback(restore.checkpoint);
  }
</script>

<button
  type="button"
  class:busy={restore.busy}
  class="ckpt-restore"
  title={`Roll the workdir back to checkpoint ${restore.checkpoint.hash} and fork the session here`}
  aria-label={`Roll back to checkpoint ${restore.checkpoint.hash} and fork the session`}
  aria-busy={restore.busy ?? false}
  disabled={restore.busy}
  onclick={handleClick}
><span aria-hidden="true">↩</span></button>
