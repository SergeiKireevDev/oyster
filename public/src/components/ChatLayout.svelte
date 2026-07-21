<script>
  import Composer from "./Composer.svelte";
  import SessionSidebar from "./SessionSidebar.svelte";
  import Sidebars from "./Sidebars.svelte";
  import Transcript from "./Transcript.svelte";
  import { clearTranscriptNotice, transcriptNotice } from "../stores/transcriptNotice.js";

  let scroller;

  function scrollToNewest() {
    scroller.scrollTop = scroller.scrollHeight;
    clearTranscriptNotice();
  }

  function trackScroll() {
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120) clearTranscriptNotice();
  }
</script>

<div id="main">
  <SessionSidebar />
  <div id="chatcol">
    <div class="transcript-shell">
      <div id="scroller" bind:this={scroller} onscroll={trackScroll}><Transcript /></div>
      {#if $transcriptNotice}
        <button id="transcriptNotice" aria-label="Scroll to new transcript events" title="New messages available" onclick={scrollToNewest}>↓</button>
      {/if}
    </div>
    <Composer />
  </div>

  <Sidebars />
</div>
