<script>
  export let src;
  export let alt = "Pinned SVG";
  let zoomed = false;
</script>

<section class="pinned-svg-viewer" class:zoomed aria-label={`SVG viewer: ${alt}`}>
  <div class="pinned-svg-toolbar">
    <span>SVG · vector</span>
    <button type="button" class="chip" aria-pressed={zoomed} onclick={() => { zoomed = !zoomed; }}>
      {zoomed ? "Fit" : "Original size"}
    </button>
  </div>
  <button
    type="button"
    class="pinned-svg-stage"
    aria-label={`${zoomed ? "Fit" : "View original size"}: ${alt}`}
    onclick={() => { zoomed = !zoomed; }}
  >
    <!-- SVG remains in the browser's inert image context; it is never injected as markup. -->
    <img {src} {alt} loading="eager" draggable="false" />
  </button>
</section>
