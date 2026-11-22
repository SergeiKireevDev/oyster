<script>
  import { formatRelativeTime } from "../../lib/relativeTime.js";
  import { highlightThreadQuotes } from "../../lib/threadQuoteHighlights.js";
  import { quoteSnippet } from "../../features/threads/threadModel.js";
  import { getUiActionRegistry } from "../../runtime/uiActionContext.js";
  import { THREAD_DELETE_ACTION, THREAD_OPEN_ACTION } from "../../runtime/uiActionNames.js";
  import { expandedThreadAnchors, toggleThreadAnchor } from "../../stores/threads.js";

  /**
   * The threads opened on one reply: a pill that expands into one row per
   * thread. Each row opens that thread's own session.
   *
   * @typedef {object} Props
   * @property {Array<Record<string, any>>} [threads]
   * @property {string} [anchorKey] identifies the reply, so its list stays open across re-renders
   */

  /** @type {Props} */
  let { threads = [], anchorKey = "" } = $props();

  const uiActions = getUiActionRegistry();
  const expanded = $derived($expandedThreadAnchors.has(anchorKey));
  const listId = $props.id();

  const working = $derived(threads.some((thread) => thread.alive && thread.busy));
  const unread = $derived(threads.some((thread) => thread.attentionUnread));
  const summary = $derived(`${threads.length} thread${threads.length === 1 ? "" : "s"}`);
  const quotes = $derived(threads.map((thread) => thread.quote));
  const rows = $derived(threads.map((thread) => ({
    thread,
    snippet: quoteSnippet(thread.quote),
    status: thread.alive && thread.busy ? "busy" : thread.attentionUnread ? "unread" : "idle",
    meta: rowMeta(thread),
  })));

  function rowMeta(thread) {
    const count = thread.messages ?? 0;
    const size = count ? `${count} message${count === 1 ? "" : "s"}` : "no reply yet";
    const activity = formatRelativeTime(thread.modifiedAt ?? thread.createdAt);
    return activity ? `${size} · ${activity}` : size;
  }

  function statusLabel(status) {
    if (status === "busy") return "Working";
    return status === "unread" ? "New reply" : "";
  }

  const toggle = () => toggleThreadAnchor(anchorKey);
  const open = (thread) => uiActions.invoke(THREAD_OPEN_ACTION, thread);
  const remove = (thread) => uiActions.invoke(THREAD_DELETE_ACTION, thread);
</script>

<div class="thread-markers" class:expanded use:highlightThreadQuotes={quotes}>
  <button
    type="button"
    class="thread-pill"
    class:working
    class:unread
    aria-expanded={expanded}
    aria-controls={listId}
    onclick={toggle}
  >
    <span class="thread-pill-chevron" aria-hidden="true"></span>
    <span>{summary}</span>
    {#if working}<span class="thread-status busy" role="img" aria-label="A thread is working"></span>
    {:else if unread}<span class="thread-status unread" role="img" aria-label="A thread has a new reply"></span>{/if}
  </button>
  {#if expanded}
    <ul class="thread-rows" id={listId}>
      {#each rows as row (row.thread.id)}
        <li class="thread-row">
          <button type="button" class="thread-row-open" title={`Open thread: ${row.thread.label}`} onclick={() => open(row.thread)}>
            <span class="thread-row-heading">
              <span class="thread-row-label">{row.thread.label}</span>
              {#if row.status !== "idle"}<span class={`thread-status ${row.status}`} role="img" aria-label={statusLabel(row.status)}></span>{/if}
            </span>
            <span class="thread-row-quote">“{row.snippet}”</span>
            <span class="thread-row-meta">{row.meta}</span>
          </button>
          <button type="button" class="thread-row-delete" title="Delete thread" aria-label={`Delete thread: ${row.thread.label}`} onclick={() => remove(row.thread)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .thread-markers {
    display: flex;
    max-width: 840px;
    margin: 2px 4px 8px;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .thread-pill {
    display: inline-flex;
    min-height: 26px;
    align-items: center;
    gap: 7px;
    padding: 3px 11px 3px 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: color-mix(in srgb, var(--accent) 72%, var(--text));
    font: 600 12px/1.3 inherit;
    cursor: pointer;
    transition: background .14s ease, border-color .14s ease;
  }

  .thread-pill:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, transparent); }
  .thread-pill:focus-visible, .thread-row-open:focus-visible, .thread-row-delete:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .thread-pill-chevron {
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
    transition: transform .14s ease;
  }

  .expanded .thread-pill-chevron { transform: rotate(45deg) translate(-1px, -1px); }

  .thread-status {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--muted);
  }

  .thread-status.busy { background: var(--yellow); animation: thread-pulse 1.2s ease-in-out infinite; }
  .thread-status.unread { background: var(--accent); }

  .thread-rows {
    display: flex;
    width: 100%;
    margin: 0;
    padding: 0 0 0 10px;
    flex-direction: column;
    gap: 4px;
    border-inline-start: 2px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    list-style: none;
  }

  .thread-row {
    display: flex;
    min-width: 0;
    align-items: stretch;
    gap: 4px;
  }

  .thread-row-open {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .thread-row-open:hover { border-color: var(--border); background: var(--surface-hover); }

  .thread-row-heading { display: flex; align-items: center; gap: 7px; }
  .thread-row-label { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }

  .thread-row-quote {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-row-meta { color: var(--muted); font-size: 11px; }

  .thread-row-delete {
    display: grid;
    width: 28px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
  }

  .thread-row:hover .thread-row-delete,
  .thread-row:focus-within .thread-row-delete { opacity: 1; }
  .thread-row-delete:hover { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }

  @keyframes thread-pulse {
    50% { opacity: .35; }
  }

  @media (hover: none) {
    .thread-row-delete { opacity: 1; }
  }

  @media (max-width: 760px) {
    .thread-pill { min-height: 32px; }
    .thread-row-delete { width: 36px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .thread-status.busy { animation: none; }
    .thread-pill, .thread-pill-chevron { transition: none; }
  }
</style>
