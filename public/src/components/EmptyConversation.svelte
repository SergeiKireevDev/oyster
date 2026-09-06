<script>
  let { workdir = "", model = "", onChoose } = $props();
  const starters = [
    { label: "Explain this project", prompt: "Explore this project and explain its structure, how to run it, and where to start." },
    { label: "Review recent changes", prompt: "Review the recent changes in this project. Highlight likely bugs and missing tests without changing files." },
  ];
</script>

<section class="empty-conversation" aria-labelledby="empty-conversation-title">
  <span class="empty-kicker">Your workspace is ready</span>
  <h2 id="empty-conversation-title">What would you like to work on?</h2>
  <p>Ask your agent to explore code, review changes, or help build something. Replies and tool activity appear here.</p>
  <dl>
    <div><dt>Folder</dt><dd>{workdir || "Current workspace"}</dd></div>
    <div><dt>Model</dt><dd>{model || "Choose a model in session controls"}</dd></div>
  </dl>
  <div class="starter-actions">
    {#each starters as starter (starter.label)}
      <button type="button" onclick={() => onChoose(starter.prompt)}>{starter.label}<span aria-hidden="true"> ↗</span></button>
    {/each}
  </div>
  <p class="starter-hint">Choose a starter to draft a message. Nothing runs until you send.</p>
</section>

<style>
  .empty-conversation { width: 100%; max-width: 560px; margin: clamp(12px, 7vh, 80px) auto 20px; }
  .empty-kicker { color: var(--accent); font-size: 12px; font-weight: 650; }
  h2 { margin: 10px 0; color: var(--text); font-size: clamp(22px, 3vw, 30px); line-height: 1.2; letter-spacing: -.025em; }
  p { margin: 0 0 18px; color: var(--text-secondary); font-size: 14px; line-height: 1.6; }
  dl { margin: 20px 0; padding: 12px 0; border-block: 1px solid var(--border); }
  dl > div { display: flex; gap: 14px; margin: 4px 0; font-size: 12px; }
  dt { width: 42px; flex: none; color: var(--muted); }
  dd { min-width: 0; margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
  .starter-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  button { min-height: 44px; padding: 10px 14px; border: 1px solid var(--selection-border); border-radius: 10px; background: var(--selection-bg); color: var(--selection-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  button:hover { border-color: var(--accent); background: var(--surface-hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .starter-hint { margin-top: 12px; font-size: 12px; }
  @media (max-width: 520px) { .starter-actions { flex-direction: column; } button { text-align: left; } }
</style>
