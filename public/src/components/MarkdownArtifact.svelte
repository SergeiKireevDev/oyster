<script>
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";

  /** @type {{ source?: string; label?: string }} */
  let { source = "", label = "Markdown artifact" } = $props();

  const ZOOM_LEVELS = Object.freeze([50, 75, 100, 125, 150, 200, 300]);
  const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS.indexOf(100);
  const hasRenderableContent = $derived(source.trim().length > 0);
  let exploredDiagram = $state(null);
  let zoomIndex = $state(DEFAULT_ZOOM_INDEX);
  const zoomPercent = $derived(ZOOM_LEVELS[zoomIndex]);
  const canZoomOut = $derived(zoomIndex > 0);
  const canZoomIn = $derived(zoomIndex < ZOOM_LEVELS.length - 1);
  const exploredMarkdown = $derived(exploredDiagram ? mermaidFence(exploredDiagram.source) : "");
  const exploredLabel = $derived(exploredDiagram ? `Explore Mermaid diagram ${exploredDiagram.index + 1}` : "Mermaid diagram explorer");

  function mermaidFence(diagramSource) {
    const longestRun = Math.max(0, ...[...diagramSource.matchAll(/`+/g)].map((match) => match[0].length));
    const marker = "`".repeat(Math.max(3, longestRun + 1));
    return `${marker}mermaid\n${diagramSource}\n${marker}`;
  }

  /** @param {{ index: number; source: string }} diagram */
  function exploreDiagram(diagram) {
    exploredDiagram = diagram;
    zoomIndex = DEFAULT_ZOOM_INDEX;
  }

  function closeExplorer() {
    exploredDiagram = null;
    zoomIndex = DEFAULT_ZOOM_INDEX;
  }

  function zoomOut() {
    if (canZoomOut) zoomIndex--;
  }

  function zoomIn() {
    if (canZoomIn) zoomIndex++;
  }

  function resetZoom() {
    zoomIndex = DEFAULT_ZOOM_INDEX;
  }
</script>

<section class="markdown-artifact">
  {#if exploredDiagram}
    <section class="mermaid-explorer" aria-label={exploredLabel}>
      <header class="mermaid-explorer-toolbar">
        <div>
          <strong>Diagram explorer</strong>
          <span role="status" aria-live="polite" aria-atomic="true">{zoomPercent}%</span>
        </div>
        <div class="mermaid-explorer-actions" role="group" aria-label="Diagram zoom controls">
          <button type="button" class="chip" onclick={zoomOut} disabled={!canZoomOut} aria-label="Zoom out">−</button>
          <button type="button" class="chip" onclick={resetZoom} disabled={zoomPercent === 100}>Reset</button>
          <button type="button" class="chip" onclick={zoomIn} disabled={!canZoomIn} aria-label="Zoom in">+</button>
          <button type="button" class="chip mermaid-explorer-close" onclick={closeExplorer}>Back to reader</button>
        </div>
      </header>
      <div class="mermaid-explorer-viewport" role="region" aria-label="Zoomed Mermaid diagram; scroll to explore">
        <SanitizedMarkdown
          className={`pinned-markdown-viewer mermaid-explorer-render mermaid-zoom-${zoomPercent}`}
          source={exploredMarkdown}
          label={exploredLabel}
          enableMermaid={true}
        />
      </div>
    </section>
  {:else if hasRenderableContent}
    <SanitizedMarkdown
      element="article"
      className="pinned-markdown-viewer"
      {source}
      {label}
      enableMermaid={true}
      onMermaidExplore={exploreDiagram}
    />
  {:else}
    <p class="artifact-state artifact-state-empty" role="status" aria-atomic="true">
      <span>This Markdown artifact is empty.</span>
    </p>
  {/if}
</section>

<style>
  .markdown-artifact {
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 100%;
  }

  .mermaid-explorer {
    display: flex;
    min-width: 0;
    min-height: 100%;
    flex-direction: column;
  }

  .mermaid-explorer-toolbar {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    backdrop-filter: blur(12px);
  }

  .mermaid-explorer-toolbar > div {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .mermaid-explorer-toolbar strong {
    color: var(--text);
    font-size: 12px;
  }

  .mermaid-explorer-toolbar span {
    min-width: 4ch;
    color: var(--muted);
    font: 11px/1 var(--mono);
    text-align: right;
  }

  .mermaid-explorer-actions .chip {
    min-width: 34px;
    min-height: 32px;
    justify-content: center;
    padding: 5px 9px;
  }

  .mermaid-explorer-actions .chip:disabled {
    opacity: 0.42;
    cursor: default;
    transform: none;
  }

  .mermaid-explorer-close {
    margin-left: 3px;
  }

  .mermaid-explorer-viewport {
    min-width: 0;
    min-height: 0;
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
  }

  @media (max-width: 620px) {
    .mermaid-explorer-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .mermaid-explorer-actions {
      width: 100%;
    }

    .mermaid-explorer-actions .chip {
      min-height: 40px;
    }

    .mermaid-explorer-close {
      margin-left: auto;
    }
  }
</style>
