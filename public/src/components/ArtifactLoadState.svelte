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
  <div class="artifact-state artifact-state-empty" role="status" aria-atomic="true">
    <span>{message.empty}</span>
  </div>
{:else if status === "loading"}
  <div class="artifact-state artifact-state-loading" role="status" aria-atomic="true">
    <span class="spin" aria-hidden="true"></span>
    <span>{message.loading}</span>
  </div>
{:else if status === "error"}
  <div class="artifact-state artifact-state-error" role="alert" aria-atomic="true">
    <span class="artifact-state-error-mark" aria-hidden="true">!</span>
    <span>{message.error}</span>
    <button type="button" class="chip" onclick={onRetry}>Retry</button>
  </div>
{/if}
