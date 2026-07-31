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
