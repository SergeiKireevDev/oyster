<script>
  import AppIcon from "../AppIcon.svelte";

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
>
  <AppIcon name="copy" size={15} />
</button>

<style>
  .message-copy {
    position: absolute;
    z-index: 2;
    top: 2px;
    display: inline-grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: color-mix(in srgb, var(--panel-2) 92%, var(--bg));
    box-shadow: 0 4px 12px color-mix(in srgb, var(--bg) 38%, transparent);
    color: var(--muted);
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    user-select: none;
    transition: color .15s, border-color .15s, background .15s, opacity .15s, transform .15s;
  }

  .message-copy:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--surface-hover);
    color: var(--accent);
    opacity: 1 !important;
    transform: translateY(-1px);
  }

  .message-copy:active { transform: none; }

  @media (max-width: 760px) {
    .message-copy {
      min-width: var(--icon-control-dense);
      min-height: var(--icon-control-dense);
    }
  }
</style>
