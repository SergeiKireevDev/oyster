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
  title={restore.busy
    ? `Restoring checkpoint ${restore.checkpoint.hash}…`
    : `Roll the workdir back to checkpoint ${restore.checkpoint.hash} and fork the session here`}
  aria-label={`Roll back to checkpoint ${restore.checkpoint.hash} and fork the session`}
  aria-busy={restore.busy ?? false}
  disabled={restore.busy}
  onclick={handleClick}
>
  {#if restore.busy}
    <span class="restore-spinner" aria-hidden="true"></span>
  {:else}
    <span aria-hidden="true">↩</span>
  {/if}
</button>

<style>
  .ckpt-restore {
    position: static;
    z-index: 2;
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
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    opacity: .78;
    user-select: none;
    transition: color .15s, border-color .15s, background .15s, opacity .15s, transform .15s;
  }

  .ckpt-restore:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--surface-hover);
    color: var(--accent);
    opacity: 1;
    transform: translateY(-1px);
  }

  .ckpt-restore:active:not(:disabled) { transform: none; }

  .ckpt-restore:disabled {
    cursor: wait;
    opacity: .45;
  }

  .restore-spinner {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: restore-spin .8s linear infinite;
  }

  @keyframes restore-spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    .ckpt-restore {
      min-width: var(--icon-control-dense);
      min-height: var(--icon-control-dense);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .restore-spinner { animation: none; }
  }
</style>
