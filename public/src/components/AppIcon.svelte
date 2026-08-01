<script>
  const DEFAULT_SIZE = 16;

  /** @param {unknown} value */
  function normalizeSize(value) {
    const numericSize = Number(value);
    return Number.isFinite(numericSize) && numericSize > 0 ? numericSize : DEFAULT_SIZE;
  }

  /**
   * @type {{
   *   name: "analytics" | "key" | "settings" | "logout" | "fork" | "sliders" | "model" | "thinking" | "more" | "file" | "copy";
   *   size?: number;
   *   class?: string;
   * }}
   */
  let { name, size = DEFAULT_SIZE, class: className = "" } = $props();

  let normalizedSize = $derived(normalizeSize(size));
</script>

<span class={`app-icon ${className}`.trim()} style:--app-icon-size={`${normalizedSize}px`} aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none" focusable="false">
    {#if name === "analytics"}
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    {:else if name === "key"}
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l3 3M14 9l2 2" />
    {:else if name === "settings"}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.6.66 1 1.52 1H21v4h-.08c-.86 0-1.38.4-1.52 1Z" />
    {:else if name === "logout"}
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    {:else if name === "fork"}
      <circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" />
      <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
    {:else if name === "sliders"}
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" />
    {:else if name === "model"}
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    {:else if name === "thinking"}
      <path d="m12 3 1.15 3.1L16 7.25l-2.85 1.15L12 11.5 10.85 8.4 8 7.25l2.85-1.15L12 3ZM18.5 13l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2ZM6 13l1.05 2.95L10 17l-2.95 1.05L6 21l-1.05-2.95L2 17l2.95-1.05L6 13Z" />
    {:else if name === "more"}
      <circle cx="5" cy="12" r="1.25" class="filled" /><circle cx="12" cy="12" r="1.25" class="filled" /><circle cx="19" cy="12" r="1.25" class="filled" />
    {:else if name === "file"}
      <path d="M6 3h8l4 4v14H6zM14 3v5h4" />
    {:else if name === "copy"}
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    {/if}
  </svg>
</span>

<style>
  .app-icon {
    display: inline-flex;
    width: var(--app-icon-size);
    height: var(--app-icon-size);
    flex: none;
    align-items: center;
    justify-content: center;
    color: inherit;
    line-height: 0;
    pointer-events: none;
    vertical-align: -0.125em;
  }

  .app-icon > svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .app-icon :is(path, circle, rect) {
    stroke: currentColor;
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .app-icon .filled {
    fill: currentColor;
    stroke: none;
  }
</style>
