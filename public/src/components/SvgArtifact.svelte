<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  /** @typedef {"loading" | "ready" | "error"} ArtifactStatus */

  /** @type {{ src?: string; alt?: string }} */
  let { src = "", alt = "Pinned SVG" } = $props();

  let zoomed = $state(false);
  /** @type {ArtifactStatus} */
  let status = $state("loading");
  let attempt = $state(0);
  let activeSource = $state("");

  let accessibleLabel = $derived(String(alt || "").trim() || "Pinned SVG");
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
  class="pinned-svg-viewer"
  class:zoomed
  aria-label={`SVG viewer: ${accessibleLabel}`}
  aria-busy={loading}
>
  <div class="pinned-media-toolbar">
    <span>SVG · vector</span>
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

  <ArtifactLoadState kind="svg" available={Boolean(src)} {status} onRetry={retry} />
  {#if src}
    <button
      type="button"
      class="pinned-svg-stage"
      aria-label={`${zoomed ? "Fit" : "View original size"}: ${accessibleLabel}`}
      aria-pressed={zoomed}
      onclick={toggleZoom}
    >
      <!-- SVG remains in the browser's inert image context; it is never injected as markup. -->
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
  .pinned-svg-viewer {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 55vh;
    flex-direction: column;
  }

  .pinned-svg-stage {
    box-sizing: border-box;
    min-width: 0;
    min-height: 50vh;
    flex: 1;
    padding: clamp(16px, 4vw, 42px);
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--panel) 72%, var(--bg));
    background-image:
      linear-gradient(45deg, color-mix(in srgb, var(--border) 42%, transparent) 25%, transparent 25%),
      linear-gradient(-45deg, color-mix(in srgb, var(--border) 42%, transparent) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--border) 42%, transparent) 75%),
      linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--border) 42%, transparent) 75%);
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-size: 16px 16px;
  }

  .pinned-svg-stage img {
    max-height: 62vh;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .pinned-svg-stage img.ready {
    opacity: 1;
  }

  .pinned-svg-viewer.zoomed .pinned-svg-stage {
    place-items: start;
    padding: 12px;
    cursor: zoom-out;
  }

  .pinned-svg-viewer.zoomed .pinned-svg-stage img {
    max-width: none;
    max-height: none;
  }

  @media (max-width: 760px) {
    .pinned-svg-viewer {
      min-height: calc(100dvh - 190px);
    }

    .pinned-svg-stage {
      min-height: calc(100dvh - 230px);
      padding: 10px;
    }
  }
</style>
