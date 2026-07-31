<script>
  /**
   * @typedef {object} Props
   * @property {() => void} [onCheckpoint]
   * @property {boolean} [busy]
   */

  /** @type {Props} */
  let { onCheckpoint = () => {}, busy = false } = $props();

  /** @param {MouseEvent} event */
  function handleClick(event) {
    event.stopPropagation();
    onCheckpoint();
  }
</script>

<button
  type="button"
  class:busy
  class="checkpoint"
  title="Checkpoint — commit all workdir changes"
  aria-label="Checkpoint all workdir changes"
  aria-busy={busy}
  disabled={busy}
  onclick={handleClick}
><span aria-hidden="true">🧊</span></button>
