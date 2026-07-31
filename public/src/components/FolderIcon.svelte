<script>
  const DEFAULT_SIZE = 16;

  /** @param {unknown} value */
  function normalizeSize(value) {
    const numericSize = Number(value);
    return Number.isFinite(numericSize) && numericSize > 0 ? numericSize : DEFAULT_SIZE;
  }

  /**
   * @type {{
   *   size?: number;
   *   class?: string;
   * }}
   */
  let { size = DEFAULT_SIZE, class: className = "" } = $props();

  let normalizedSize = $derived(normalizeSize(size));
</script>

<span class={`folder-icon ${className}`.trim()} style:--folder-icon-size={`${normalizedSize}px`} aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none" focusable="false">
    <path d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h4.1l2.05 2.15h6.35a2.25 2.25 0 0 1 2.25 2.25v7.35A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25v-9.5Z" />
    <path d="M3.75 10h16.5" />
  </svg>
</span>

<style>
  .folder-icon {
    display: inline-flex;
    width: var(--folder-icon-size);
    height: var(--folder-icon-size);
    flex: none;
    align-items: center;
    justify-content: center;
    color: inherit;
    line-height: 0;
    pointer-events: none;
    vertical-align: -0.125em;
  }

  .folder-icon > svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .folder-icon path {
    stroke: currentColor;
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
