<script>
  import Composer from "./Composer.svelte";
  import Sidebars from "./Sidebars.svelte";
</script>

<div id="main">
  <div id="chatcol">
    <div id="scroller"><div id="messages"></div></div>
    <Composer />
  </div>

  <Sidebars />
</div>
