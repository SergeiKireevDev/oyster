<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  /** @typedef {"loading" | "ready" | "error"} ArtifactStatus */

  /** @type {{ src?: string; label?: string }} */
  let { src = "", label = "HTML artifact" } = $props();

  /** @type {ArtifactStatus} */
  let status = $state("loading");
  let attempt = $state(0);
  /** @type {string | undefined} */
  let activeSource = $state();

  let accessibleLabel = $derived(String(label || "").trim() || "HTML artifact");
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

  function handleLoad() {
    status = "ready";
  }

  function handleError() {
    status = "error";
  }
</script>

<section
  class="pinned-html-viewer"
  aria-label={`HTML artifact viewer: ${accessibleLabel}`}
  aria-busy={loading}
>
  <ArtifactLoadState kind="html" available={Boolean(src)} {status} onRetry={retry} />
  {#if src}
    {#key `${src}:${attempt}`}
      <!-- An empty sandbox keeps artifact documents isolated and disables scripts, forms, and navigation. -->
      <iframe
        class="pinned-html-preview"
        title={`HTML preview: ${accessibleLabel}`}
        {src}
        sandbox=""
        referrerpolicy="no-referrer"
        onload={handleLoad}
        onerror={handleError}
      ></iframe>
    {/key}
  {/if}
</section>

<style>
  .pinned-html-viewer {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 55vh;
    overflow: hidden;
    border-radius: inherit;
    background: color-mix(in srgb, var(--panel) 96%, var(--bg));
  }

  .pinned-html-preview {
    box-sizing: border-box;
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 55vh;
    border: 0;
    background: #fff;
  }

  @media (max-width: 760px) {
    .pinned-html-viewer,
    .pinned-html-preview {
      min-height: calc(100dvh - 190px);
    }
  }
</style>
