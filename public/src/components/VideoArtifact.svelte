<script>
  export let src;
  export let label = "Pinned video";
  export let autoplay = false;
  export let thumbnail = false;
</script>

<div class:pinned-video-frame={true} class:thumbnail>
  <video
    {src}
    aria-label={label}
    controls={!thumbnail}
    muted={thumbnail}
    preload={thumbnail ? "metadata" : "metadata"}
    autoplay={autoplay && !thumbnail}
    playsinline
  ></video>
  {#if thumbnail}<span class="pinned-video-play" aria-hidden="true">▶</span>{/if}
</div>
