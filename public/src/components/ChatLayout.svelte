<script>
  import Composer from "./Composer.svelte";
  import Sidebars from "./Sidebars.svelte";
  import Transcript from "./Transcript.svelte";
</script>

<div id="main">
  <div id="chatcol">
    <div id="scroller"><Transcript /></div>
    <Composer />
  </div>

  <Sidebars />
</div>
