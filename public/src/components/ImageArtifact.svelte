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

<ArtifactLoadState kind="image" available={Boolean(src)} {status} onRetry={retry} />
{#if src}
  <button
    type="button"
    class="pinned-image-frame"
    class:zoomed
    aria-label={`${zoomed ? "Fit" : "View original size"}: ${alt || "Pinned image"}`}
    aria-pressed={zoomed}
    onclick={toggleZoom}
  >
    {#key `${src}:${attempt}`}
      <img
        {src}
        {alt}
        loading="eager"
        draggable="false"
        onload={handleLoad}
        onerror={handleError}
      />
    {/key}
  </button>
{/if}
