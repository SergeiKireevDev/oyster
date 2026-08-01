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
  title={busy ? "Creating checkpoint…" : "Checkpoint — commit all workdir changes"}
  aria-label="Checkpoint all workdir changes"
  aria-busy={busy}
  disabled={busy}
  onclick={handleClick}
>
  {#if busy}
    <span class="checkpoint-spinner" aria-hidden="true"></span>
  {:else}
    <span aria-hidden="true">🧊</span>
  {/if}
</button>

<style>
  .checkpoint {
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
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    opacity: .78;
    user-select: none;
    transition: color .15s, border-color .15s, background .15s, opacity .15s, transform .15s;
  }

  .checkpoint:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--surface-hover);
    color: var(--accent);
    opacity: 1;
    transform: translateY(-1px);
  }

  .checkpoint:active:not(:disabled) { transform: none; }

  .checkpoint:disabled {
    cursor: wait;
    opacity: .45;
  }

  .checkpoint-spinner {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: checkpoint-spin .8s linear infinite;
  }

  @keyframes checkpoint-spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    .checkpoint {
      min-width: 38px;
      min-height: 38px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .checkpoint-spinner { animation: none; }
  }
</style>
