<script>
  /**
   * @typedef {object} Props
   * @property {HTMLElement | null} [target]
   * @property {(target: HTMLElement | null) => void} [onPermalink]
   */

  /** @type {Props} */
  let { target = null, onPermalink = () => {} } = $props();

  const label = "Copy a permalink to this message";

  /** @param {MouseEvent} event */
  function handleClick(event) {
    event.stopPropagation();
    onPermalink(target);
  }
</script>

<button
  type="button"
  class="permalink"
  title={label}
  aria-label={label}
  onclick={handleClick}
><span aria-hidden="true">🔗</span></button>
