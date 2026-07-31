<script>
  /**
   * @typedef {object} Props
   * @property {string} [text]
   * @property {(text: string) => void} [onCopy]
   */

  /** @type {Props} */
  let { text = "", onCopy = () => {} } = $props();

  const label = "Copy this message";

  /** @param {MouseEvent} event */
  function handleClick(event) {
    event.stopPropagation();
    onCopy(text);
  }
</script>

<button
  type="button"
  class="message-copy"
  title={label}
  aria-label={label}
  onclick={handleClick}
><span aria-hidden="true">⧉</span></button>
