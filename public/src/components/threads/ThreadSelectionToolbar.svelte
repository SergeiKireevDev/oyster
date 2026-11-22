<script>
  import { onDestroy } from "svelte";
  import { createFrameScheduler } from "../../lib/frameScheduler.js";
  import { reportNode } from "../../lib/nodeReporter.js";
  import { clearTextSelection, measureReplySelection } from "../../lib/threadSelectionDom.js";
  import { THREAD_QUESTIONS } from "../../features/threads/threadModel.js";
  import { getUiActionRegistry } from "../../runtime/uiActionContext.js";
  import { THREAD_START_ACTION } from "../../runtime/uiActionNames.js";
  import { threadDraft, threadPending, threadView } from "../../stores/threads.js";
  import { transcriptItems } from "../../stores/transcriptItems.js";

  /**
   * The row of question buttons shown next to a text selection inside a reply.
   * It floats over the transcript, positioned within the scroller's parent.
   *
   * @typedef {object} Props
   * @property {HTMLElement | null} [scroller] the scrolling transcript viewport
   */

  /** @type {Props} */
  let { scroller = null } = $props();

  const uiActions = getUiActionRegistry();
  const harnesses = Array.isArray(globalThis.__OYSTER_RUNTIME_CONFIG__?.harnesses) ? globalThis.__OYSTER_RUNTIME_CONFIG__.harnesses : [];

  /** @type {{ entry: Element, quote: string, top: number, left: number, last: boolean } | null} */
  let selected = $state(null);
  // Plain bindings: neither the toolbar node nor an in-flight press drives rendering.
  let toolbar = null;
  let pressing = false;

  // "entry" harnesses fork at any finished reply; "tip" harnesses copy the whole session and need it idle.
  const forkMode = $derived(harnesses.find((harness) => harness.id === ($threadView.harness ?? "pi"))?.threadFork ?? null);
  const blocked = $derived(Boolean(selected) && $threadView.busy && (forkMode === "tip" || selected.last));
  const hint = $derived(blocked ? "Available once the reply has finished" : "Open a thread about the selected text");
  const visible = $derived(Boolean(selected) && Boolean(forkMode) && !$threadDraft);

  // A press on the toolbar may collapse the selection before the click lands
  // (touch browsers); the captured selection stays put until the press ends.
  function measure() {
    if (!pressing) selected = measureReplySelection(scroller, toolbar);
  }

  const measurement = createFrameScheduler(measure);
  // Re-rendering the transcript drops a selection without any selection event: look again.
  const stopWatchingTranscript = transcriptItems.subscribe(() => measurement.schedule());
  onDestroy(() => {
    stopWatchingTranscript();
    measurement.cancel();
  });

  // The toolbar's size is only known once it has rendered: place it again then.
  function toolbarMounted(node) {
    toolbar = node;
    measurement.schedule();
  }

  // Keep the text selected while a button is pressed; a default mousedown would collapse it.
  function keepSelection(event) {
    event.preventDefault();
    pressing = true;
  }

  function releasePress() {
    if (!pressing) return;
    pressing = false;
    measurement.schedule();
  }

  function ask(question) {
    if (!selected || blocked || $threadPending) return;
    const { entry, quote } = selected;
    clearTextSelection(scroller);
    selected = null;
    uiActions.invoke(THREAD_START_ACTION, { element: entry, quote, question });
  }
</script>

<svelte:document onselectionchange={measurement.schedule} onscrollcapture={measurement.schedule} onpointerup={releasePress} onpointercancel={releasePress} />

{#if visible}
  <div
    class="thread-toolbar"
    role="toolbar"
    tabindex="-1"
    aria-label="Ask about the selected text"
    title={hint}
    style:top={`${selected.top}px`}
    style:left={`${selected.left}px`}
    use:reportNode={toolbarMounted}
    onpointerdown={keepSelection}
  >
    {#each THREAD_QUESTIONS as question (question.id)}
      <button type="button" class="thread-question" disabled={blocked || $threadPending} onclick={() => ask(question.id)}>{question.label}</button>
    {/each}
  </div>
{/if}

<style>
  .thread-toolbar {
    position: absolute;
    z-index: 14;
    display: flex;
    gap: 2px;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 11px;
    background: var(--panel-2);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--bg) 62%, transparent);
    user-select: none;
    -webkit-user-select: none;
  }

  .thread-question {
    min-height: 30px;
    padding: 4px 11px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: 600 12.5px/1.3 inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .thread-question:hover:not(:disabled) { background: var(--accent-dim); }
  .thread-question:disabled { color: var(--muted); cursor: not-allowed; }
  .thread-question:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  @media (max-width: 760px) {
    .thread-question { min-height: 38px; padding-inline: 13px; }
  }
</style>
