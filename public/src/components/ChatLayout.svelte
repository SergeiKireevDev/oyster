<script>
  import { onDestroy } from "svelte";
  import Composer from "./Composer.svelte";
  import SessionSidebar from "./SessionSidebar.svelte";
  import Sidebars from "./Sidebars.svelte";
  import Transcript from "./Transcript.svelte";
  import { clearTranscriptNotice, transcriptNotice } from "../stores/transcriptNotice.js";
  import { createFrameScheduler } from "../lib/frameScheduler.js";

  const NOTICE_CLEARANCE_PX = 120;
  let scroller = null;

  function isNearNewest(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < NOTICE_CLEARANCE_PX;
  }

  function scrollToNewest() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    clearTranscriptNotice();
  }

  const scrollTracking = createFrameScheduler((node) => {
    if (isNearNewest(node)) clearTranscriptNotice();
  });

  function trackScroll(event) {
    scrollTracking.schedule(event.currentTarget);
  }

  onDestroy(() => scrollTracking.cancel());
</script>

<div id="main">
  <SessionSidebar />
  <main id="chatcol">
    <section class="transcript-shell" aria-label="Conversation transcript">
      <div id="scroller" bind:this={scroller} onscroll={trackScroll}><Transcript /></div>
      {#if $transcriptNotice}
        <button
          id="transcriptNotice"
          type="button"
          aria-label="Scroll to newest transcript event"
          title="New transcript events available"
          onclick={scrollToNewest}
        >
          <span aria-hidden="true">↓</span>
        </button>
      {/if}
    </section>
    <Composer />
  </main>

  <Sidebars />
</div>

<style>
  #main {
    display: flex;
    min-height: 0;
    flex: 1;
    background: transparent;
  }

  #chatcol {
    position: relative;
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg) 48%, transparent);
  }

  .transcript-shell {
    position: relative;
    min-height: 0;
    flex: 1;
  }

  #scroller {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    background:
      radial-gradient(ellipse at 50% -12%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 38%),
      linear-gradient(180deg, color-mix(in srgb, var(--text) 1%, transparent), transparent 28%);
  }

  #transcriptNotice {
    position: absolute;
    bottom: 20px;
    left: 50%;
    z-index: 12;
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 50%;
    background: var(--panel-2);
    color: var(--accent);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--muted) 22%, transparent);
    font: 700 18px/1 inherit;
    cursor: pointer;
    translate: -50% 0;
    transition: color .14s ease, border-color .14s ease, background .14s ease, transform .14s ease;
  }

  #transcriptNotice:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text);
    transform: translateY(-1px);
  }

  #transcriptNotice:active { transform: translateY(0) scale(.96); }

  @media (max-width: 760px) {
    #transcriptNotice {
      width: var(--icon-control-standard);
      height: var(--icon-control-standard);
      bottom: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    #transcriptNotice { transition: none; }
  }
</style>
