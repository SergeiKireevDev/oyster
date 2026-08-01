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
          loading="eager"
          draggable="false"
          onload={handleLoad}
          onerror={handleError}
        />
      {/key}
    </button>
  {/if}
</section>
