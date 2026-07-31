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

<ArtifactLoadState kind="html" available={Boolean(src)} {status} onRetry={retry} />
{#if src}
  {#key `${src}:${attempt}`}
    <!-- An empty sandbox keeps artifact documents isolated and disables scripts, forms, and navigation. -->
    <iframe
      class="pinned-html-preview"
      title={`HTML preview: ${label || "HTML artifact"}`}
      {src}
      sandbox=""
      referrerpolicy="no-referrer"
      aria-busy={status === "loading"}
      onload={handleLoad}
      onerror={handleError}
    ></iframe>
  {/key}
{/if}

<style>
  .pinned-html-preview {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 100%;
    border: 0;
    background: #fff;
  }
</style>
