<script>
  import CarouselDots from "./CarouselDots.svelte";
  import Toasts from "./Toasts.svelte";
</script>

<CarouselDots />

<div id="overlay"><div id="modal">
  <div class="m-title" id="mTitle"></div>
  <div class="m-body" id="mBody"></div>
  <div class="m-actions" id="mActions"></div>
</div></div>

<Toasts />

<div id="cmdPalette"></div>
