<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  /** @typedef {"loading" | "ready" | "error"} ArtifactStatus */

  /** @type {{ src?: string; alt?: string }} */
  let { src = "", alt = "Pinned image" } = $props();

  let zoomed = $state(false);
  /** @type {ArtifactStatus} */
  let status = $state("loading");
  let attempt = $state(0);
  let activeSource = $state("");

  let accessibleLabel = $derived(String(alt || "").trim() || "Pinned image");
  let loading = $derived(Boolean(src) && status === "loading");

  $effect.pre(() => {
    resetResourceState(src);
  });

  /** @param {string} nextSource */
  function resetResourceState(nextSource) {
    if (nextSource === activeSource) return;

    activeSource = nextSource;
    zoomed = false;
    status = "loading";
    attempt = 0;
  }

  function retry() {
    status = "loading";
    attempt += 1;
  }

  function toggleZoom() {
    zoomed = !zoomed;
  }

  function handleLoad() {
    status = "ready";
  }

  function handleError() {
    status = "error";
  }
</script>

<section
  class="pinned-image-viewer"
  class:zoomed
  aria-label={`Image viewer: ${accessibleLabel}`}
  aria-busy={loading}
>
  <div class="pinned-media-toolbar">
    <span>Image · raster</span>
    <button
      type="button"
      class="chip"
      aria-pressed={zoomed}
      disabled={!src}
      onclick={toggleZoom}
    >
      {zoomed ? "Fit" : "Original size"}
    </button>
  </div>

  <ArtifactLoadState kind="image" available={Boolean(src)} {status} onRetry={retry} />
  {#if src}
    <button
      type="button"
      class="pinned-image-frame"
      class:zoomed
      aria-label={`${zoomed ? "Fit" : "View original size"}: ${accessibleLabel}`}
      aria-pressed={zoomed}
      onclick={toggleZoom}
    >
      {#key `${src}:${attempt}`}
        <img
          {src}
          alt={accessibleLabel}
          class:ready={status === "ready"}
          loading="eager"
          draggable="false"
          onload={handleLoad}
          onerror={handleError}
        />
      {/key}
    </button>
  {/if}
</section>

<style>
  .pinned-image-viewer {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 55vh;
    flex-direction: column;
  }

  .pinned-image-frame {
    box-sizing: border-box;
    min-width: 0;
    min-height: 50vh;
    flex: 1;
    padding: clamp(12px, 3vw, 32px);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 72%, var(--bg));
  }

  .pinned-image-frame img {
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .pinned-image-frame img.ready {
    opacity: 1;
  }

  .pinned-image-frame.zoomed {
    padding: 12px;
  }

  @media (max-width: 760px) {
    .pinned-image-viewer {
      min-height: calc(100dvh - 190px);
    }

    .pinned-image-frame {
      min-height: calc(100dvh - 230px);
      padding: 10px;
    }
  }
</style>
