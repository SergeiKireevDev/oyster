<script>
  /** @typedef {"image" | "svg" | "video" | "html"} ArtifactKind */
  /** @typedef {"loading" | "ready" | "error"} ArtifactStatus */

  /** @type {Record<ArtifactKind, { empty: string; loading: string; error: string }>} */
  const MESSAGES = {
    image: {
      empty: "No image available.",
      loading: "Loading image…",
      error: "Image failed to load.",
    },
    svg: {
      empty: "No SVG available.",
      loading: "Loading SVG…",
      error: "SVG failed to load.",
    },
    video: {
      empty: "No video available.",
      loading: "Loading video…",
      error: "Video failed to load.",
    },
    html: {
      empty: "No HTML preview available.",
      loading: "Loading HTML preview…",
      error: "HTML preview failed to load.",
    },
  };

  /**
   * @type {{
   *   kind: ArtifactKind;
   *   available?: boolean;
   *   status?: ArtifactStatus;
   *   onRetry: () => void;
   * }}
   */
  let { kind, available = false, status = "loading", onRetry } = $props();

  let message = $derived(MESSAGES[kind]);
</script>

{#if !available}
  <div class="artifact-state" role="status" aria-atomic="true">{message.empty}</div>
{:else if status === "loading"}
  <div class="artifact-state" role="status" aria-atomic="true">{message.loading}</div>
{:else if status === "error"}
  <div class="artifact-state" role="alert" aria-atomic="true">
    {message.error} <button type="button" class="chip" onclick={onRetry}>Retry</button>
  </div>
{/if}
