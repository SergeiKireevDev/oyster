<script>
  export let kind;
  export let available = false;
  export let status = "loading";
  export let onRetry;

  const messages = {
    image: { empty: "No image available.", loading: "Loading image…", error: "Image failed to load." },
    svg: { empty: "No SVG available.", loading: "Loading SVG…", error: "SVG failed to load." },
    video: { empty: "No video available.", loading: "Loading video…", error: "Video failed to load." },
    html: { empty: "No HTML preview available.", loading: "Loading HTML preview…", error: "HTML preview failed to load." },
  };

  $: message = messages[kind];
</script>

{#if !available}
  <div class="artifact-state">{message.empty}</div>
{:else if status === "loading"}
  <div class="artifact-state" role="status">{message.loading}</div>
{:else if status === "error"}
  <div class="artifact-state" role="alert">
    {message.error} <button type="button" class="chip" onclick={onRetry}>Retry</button>
  </div>
{/if}
