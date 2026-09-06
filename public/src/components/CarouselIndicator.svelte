<script>
  /** @type {{ page: number, onNavigate: (page: number) => void }} */
  let { page, onNavigate } = $props();
</script>

<nav id="carouselIndicator" class="workspace-navigation" aria-label="Workspace navigation">
  <button class="sessions-navigation" type="button" aria-controls="sessions" aria-current={page === -1 ? "page" : undefined} onclick={() => onNavigate(-1)}>Sessions</button>
  <button type="button" aria-controls="chatcol" aria-current={page === 0 ? "page" : undefined} onclick={() => onNavigate(0)}>Chat</button>
  <button type="button" aria-controls="hublots" aria-current={page === 1 ? "page" : undefined} onclick={() => onNavigate(1)}>Widgets</button>
</nav>

<style>
  .workspace-navigation { display: none; }
  @media (max-width: 1200px) {
    .workspace-navigation {
      display: flex;
      flex: none;
      justify-content: center;
      gap: 8px;
      padding: 6px max(12px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      border-top: 1px solid var(--border);
      background: var(--panel);
    }
    button {
      min-height: 44px;
      min-width: 0;
      max-width: 180px;
      flex: 1;
      padding: 8px 12px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      cursor: pointer;
    }
    button[aria-current="page"] { border-color: var(--selection-border); background: var(--selection-bg); color: var(--selection-text); }
    button:hover { background: var(--surface-hover); color: var(--text); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  }
  @media (min-width: 961px) { .sessions-navigation { display: none; } }
</style>
