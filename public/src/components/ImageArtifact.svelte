<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  export let src;
  export let alt = "Pinned image";
  export let thumbnail = false;
  let zoomed = false;
  let status = "loading";
  let attempt = 0;

  $: resetResourceState(src);

  function resetResourceState() {
    status = "loading";
    attempt = 0;
  }

  const retry = () => { status = "loading"; attempt += 1; };
</script>

<ArtifactLoadState kind="image" available={!!src} {status} onRetry={retry} />
{#if src}
  <button
    type="button"
    class:pinned-image-frame={true}
    class:thumbnail
    class:zoomed
    aria-label={thumbnail ? `Open ${alt}` : `${zoomed ? "Fit" : "View original size"}: ${alt}`}
    onclick={() => { if (!thumbnail) zoomed = !zoomed; }}
  >
    {#key `${src}:${attempt}`}
      <img {src} {alt} loading={thumbnail ? "lazy" : "eager"} draggable="false" onload={() => { status = "ready"; }} onerror={() => { status = "error"; }} />
    {/key}
  </button>
{/if}
