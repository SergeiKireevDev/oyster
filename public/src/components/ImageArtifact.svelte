<script>
  export let src;
  export let alt = "Pinned image";
  export let thumbnail = false;
  let zoomed = false;
</script>

<button
  type="button"
  class:pinned-image-frame={true}
  class:thumbnail
  class:zoomed
  aria-label={thumbnail ? `Open ${alt}` : `${zoomed ? "Fit" : "View original size"}: ${alt}`}
  onclick={() => { if (!thumbnail) zoomed = !zoomed; }}
>
  <img {src} {alt} loading={thumbnail ? "lazy" : "eager"} draggable="false" />
</button>
