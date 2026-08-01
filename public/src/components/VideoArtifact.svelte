<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  /** @typedef {"loading" | "ready" | "error"} ArtifactStatus */

  /**
   * @type {{
   *   src?: string;
   *   label?: string;
   *   autoplay?: boolean;
   *   thumbnail?: boolean;
   * }}
   */
  let {
    src = "",
    label = "Pinned video",
    autoplay = false,
    thumbnail = false,
  } = $props();

  /** @type {ArtifactStatus} */
  let status = $state("loading");
  let attempt = $state(0);
  let activeSource = $state("");

  let accessibleLabel = $derived(String(label || "").trim() || "Pinned video");
  let loading = $derived(Boolean(src) && status === "loading");

  $effect.pre(() => {
    resetResourceState(src);
  });

  /** @param {string} nextSource */
  function resetResourceState(nextSource) {
    if (nextSource === activeSource) return;

    activeSource = nextSource;
    status = "loading";
    attempt = 0;
  }

  function retry() {
    status = "loading";
    attempt += 1;
  }

  function handleLoadedMetadata() {
    status = "ready";
  }

  function handleError() {
    status = "error";
  }
</script>

<section
  class="pinned-video-viewer"
  class:thumbnail
  aria-label={thumbnail ? undefined : `Video viewer: ${accessibleLabel}`}
  aria-busy={loading}
>
  {#if !thumbnail}
    <div class="pinned-media-toolbar">
      <span>Video · native playback</span>
    </div>
  {/if}

  <ArtifactLoadState kind="video" available={Boolean(src)} {status} onRetry={retry} />
  {#if src}
    <div class="pinned-video-frame" class:thumbnail>
      {#key `${src}:${attempt}`}
        <video
          {src}
          class:ready={status === "ready"}
          aria-label={thumbnail ? undefined : accessibleLabel}
          aria-hidden={thumbnail}
          controls={!thumbnail}
          muted={thumbnail}
          preload="metadata"
          autoplay={autoplay && !thumbnail}
          playsinline
          onloadedmetadata={handleLoadedMetadata}
          onerror={handleError}
        ></video>
      {/key}
      {#if thumbnail}
        <span class="pinned-video-play" aria-hidden="true">▶</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .pinned-video-viewer {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 55vh;
    flex-direction: column;
  }

  .pinned-video-frame {
    box-sizing: border-box;
    display: grid;
    min-width: 0;
    min-height: 50vh;
    flex: 1;
    place-items: center;
    padding: clamp(12px, 3vw, 32px);
    overflow: hidden;
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 72%, var(--bg));
  }

  .pinned-video-frame video {
    display: block;
    width: 100%;
    max-width: 100%;
    max-height: 66vh;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: 8px;
    background: #050608;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .pinned-video-frame video.ready {
    opacity: 1;
  }

  .pinned-video-viewer.thumbnail,
  .pinned-video-frame.thumbnail {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .pinned-video-frame.thumbnail {
    position: relative;
    padding: 0;
    border-radius: inherit;
    background: color-mix(in srgb, var(--bg) 92%, var(--panel));
  }

  .pinned-video-frame.thumbnail video {
    width: 100%;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: inherit;
    object-fit: cover;
  }

  .pinned-video-play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.56);
    border-radius: 50%;
    translate: -50% -50%;
    background: rgba(5, 6, 8, 0.72);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
    color: #fff;
    font-size: 13px;
    line-height: 1;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    .pinned-video-viewer:not(.thumbnail) {
      min-height: calc(100dvh - 190px);
    }

    .pinned-video-frame:not(.thumbnail) {
      min-height: calc(100dvh - 230px);
      padding: 10px;
    }
  }
</style>
