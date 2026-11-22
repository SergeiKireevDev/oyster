<script>
  import { threadPath } from "../../features/threads/threadModel.js";
  import { getUiActionRegistry } from "../../runtime/uiActionContext.js";
  import {
    THREAD_DELETE_ACTION,
    THREAD_DRAFT_CANCEL_ACTION,
    THREAD_NAVIGATE_ACTION,
    TRANSCRIPT_LOAD_EARLIER_ACTION,
  } from "../../runtime/uiActionNames.js";
  import { threadDraft, threadView } from "../../stores/threads.js";
  import { transcriptHistory } from "../../stores/transcriptHistory.js";

  /**
   * Opens a thread's transcript: where it hangs in the family, the passage it
   * is about, and a way back to the conversation it inherited. While a thread
   * is only being drafted ("Other…") the same header stands in for it.
   */
  const uiActions = getUiActionRegistry();

  const draft = $derived($threadDraft);
  const thread = $derived(draft ? null : $threadView.current);
  const quote = $derived(draft?.quote ?? thread?.quote ?? "");
  const path = $derived(thread ? threadPath($threadView.threads, thread.id) : []);
  // Every crumb leads to the reply the next step down the path is anchored to.
  const crumbs = $derived(draft ? [] : path.map((step, index) => ({
    id: step.id,
    label: index === 0 ? ($threadView.root?.name || "Session") : path[index - 1].label,
    target: { sessionKey: step.parentSessionKey, entryId: step.anchorEntryId },
  })));
  const title = $derived(draft ? "New thread" : thread?.label ?? "Thread");
  const inheritedCount = $derived($transcriptHistory.inherited ?? 0);
  const contextLabel = $derived(inheritedCount
    ? `Show earlier context (${inheritedCount} message${inheritedCount === 1 ? "" : "s"})`
    : "Show earlier context");

  const navigate = (target) => uiActions.invoke(THREAD_NAVIGATE_ACTION, target);
  const showContext = () => uiActions.invoke(TRANSCRIPT_LOAD_EARLIER_ACTION);
  const remove = () => uiActions.invoke(THREAD_DELETE_ACTION, thread);
  const cancelDraft = () => uiActions.invoke(THREAD_DRAFT_CANCEL_ACTION);
</script>

<header class="thread-header" class:draft={Boolean(draft)} aria-label="Thread">
  {#if $transcriptHistory.threadStart && !draft}
    <button type="button" class="thread-context" disabled={$transcriptHistory.loading} onclick={showContext}>
      <span class="thread-context-rule" aria-hidden="true"></span>
      <span>{contextLabel}</span>
      <span class="thread-context-rule" aria-hidden="true"></span>
    </button>
  {/if}
  <div class="thread-card">
    <nav class="thread-crumbs" aria-label="Thread location">
      {#each crumbs as crumb (crumb.id)}
        <button type="button" class="thread-crumb" title={`Back to ${crumb.label}`} onclick={() => navigate(crumb.target)}>{crumb.label}</button>
        <span class="thread-crumb-separator" aria-hidden="true">›</span>
      {/each}
      <span class="thread-crumb current" aria-current="page">{title}</span>
      {#if draft}
        <button type="button" class="thread-action" onclick={cancelDraft}>Cancel</button>
      {:else if thread}
        <button type="button" class="thread-action danger" title="Delete this thread" onclick={remove}>Delete</button>
      {/if}
    </nav>
    <blockquote class="thread-quote">{quote}</blockquote>
    {#if draft}
      <p class="thread-hint">Type your question below. The thread is created when you send it.</p>
    {/if}
  </div>
</header>

<style>
  .thread-header {
    display: flex;
    width: 100%;
    max-width: 840px;
    margin: 4px 0 14px;
    flex-direction: column;
    gap: 12px;
  }

  .thread-context {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 12px;
    padding: 6px 4px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: 600 12px/1.3 inherit;
    cursor: pointer;
  }

  .thread-context:hover:not(:disabled) { color: var(--accent); }
  .thread-context:disabled { cursor: progress; opacity: .6; }
  .thread-context-rule { height: 1px; flex: 1; background: var(--border); }

  .thread-card {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 5%, var(--panel));
  }

  .draft .thread-card { border-style: dashed; }

  .thread-crumbs {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 6px;
    font-size: 12.5px;
  }

  .thread-crumb {
    max-width: 22ch;
    overflow: hidden;
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  button.thread-crumb:hover { text-decoration: underline; }
  .thread-crumb.current { max-width: 40ch; color: var(--text); font-weight: 650; }
  .thread-crumb-separator { color: var(--muted); }

  .thread-action {
    margin-inline-start: auto;
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font: 600 11.5px/1.4 inherit;
    cursor: pointer;
  }

  .thread-action:hover { border-color: var(--accent); color: var(--text); }
  .thread-action.danger:hover { border-color: var(--red); color: var(--red); }

  .thread-context:focus-visible, .thread-crumb:focus-visible, .thread-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .thread-quote {
    max-height: 9.5em;
    margin: 0;
    padding: 2px 0 2px 12px;
    overflow-y: auto;
    border-inline-start: 3px solid color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--text-secondary);
    font-size: 13.5px;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .thread-hint { margin: 0; color: var(--muted); font-size: 12px; }

  @media (max-width: 760px) {
    .thread-crumb { max-width: 14ch; }
    .thread-action { padding: 6px 11px; }
  }
</style>
