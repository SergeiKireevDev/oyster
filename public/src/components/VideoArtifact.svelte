<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  export let src;
  export let label = "Pinned video";
  export let autoplay = false;
  export let thumbnail = false;
  let status = "loading";
  let attempt = 0;

  $: resetResourceState(src);

  function resetResourceState() {
    status = "loading";
    attempt = 0;
  }

  const retry = () => { status = "loading"; attempt += 1; };
</script>

<ArtifactLoadState kind="video" available={!!src} {status} onRetry={retry} />
{#if src}
  <div class:pinned-video-frame={true} class:thumbnail>
    {#key `${src}:${attempt}`}
      <video
        {src}
        aria-label={label}
        controls={!thumbnail}
        muted={thumbnail}
        preload="metadata"
        autoplay={autoplay && !thumbnail}
        playsinline
        onloadedmetadata={() => { status = "ready"; }}
        onerror={() => { status = "error"; }}
      ></video>
    {/key}
    {#if thumbnail}<span class="pinned-video-play" aria-hidden="true">▶</span>{/if}
  </div>
{/if}
