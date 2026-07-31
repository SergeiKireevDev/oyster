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

<ArtifactLoadState kind="video" available={Boolean(src)} {status} onRetry={retry} />
{#if src}
  <div class="pinned-video-frame" class:thumbnail aria-busy={loading}>
    {#key `${src}:${attempt}`}
      <video
        {src}
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
