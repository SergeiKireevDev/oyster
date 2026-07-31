<script>
  import ArtifactLoadState from "./ArtifactLoadState.svelte";

  export let src = "";
  export let label = "HTML artifact";
  let status = "loading";
  let attempt = 0;

  $: resetResourceState(src);

  function resetResourceState() {
    status = "loading";
    attempt = 0;
  }

  const retry = () => { status = "loading"; attempt += 1; };
</script>

<ArtifactLoadState kind="html" available={!!src} {status} onRetry={retry} />
{#if src}
  {#key `${src}:${attempt}`}
    <iframe
      class="pinned-html-preview"
      title={`HTML preview: ${label}`}
      {src}
      sandbox=""
      referrerpolicy="no-referrer"
      onload={() => { status = "ready"; }}
      onerror={() => { status = "error"; }}
    ></iframe>
  {/key}
{/if}
