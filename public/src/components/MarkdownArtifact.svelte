<script>
  import { onDestroy } from "svelte";
  import SanitizedMarkdown from "./SanitizedMarkdown.svelte";
  import { createDiagramGestureController, DEFAULT_TRANSFORM } from "../lib/diagramGestureController.js";

  /** @type {{ source?: string; label?: string }} */
  let { source = "", label = "Markdown artifact" } = $props();

  const ZOOM_LEVELS = Object.freeze([50, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1000, 1200]);
  const hasRenderableContent = $derived(source.trim().length > 0);
  let exploredDiagram = $state(null);
  let viewTransform = $state({ ...DEFAULT_TRANSFORM });
  const zoomPercent = $derived(Math.round(viewTransform.scale * 100));
  const canZoomOut = $derived(viewTransform.scale > ZOOM_LEVELS[0] / 100);
  const canZoomIn = $derived(viewTransform.scale < ZOOM_LEVELS.at(-1) / 100);
  const exploredMarkdown = $derived(exploredDiagram ? mermaidFence(exploredDiagram.source) : "");
  const exploredLabel = $derived(exploredDiagram ? `Explore Mermaid diagram ${exploredDiagram.index + 1}` : "Mermaid diagram explorer");
  const explorerGestures = createDiagramGestureController({
    onTransform(transform) { viewTransform = transform; },
    minimumScale: ZOOM_LEVELS[0] / 100,
    maximumScale: ZOOM_LEVELS.at(-1) / 100,
  });

  onDestroy(explorerGestures.destroy);

  function mermaidFence(diagramSource) {
    const longestRun = Math.max(0, ...[...diagramSource.matchAll(/`+/g)].map((match) => match[0].length));
    const marker = "`".repeat(Math.max(3, longestRun + 1));
    return `${marker}mermaid\n${diagramSource}\n${marker}`;
  }

  /** @param {{ index: number; source: string }} diagram */
  function exploreDiagram(diagram) {
    exploredDiagram = diagram;
    explorerGestures.reset();
  }

  function closeExplorer() {
    exploredDiagram = null;
    explorerGestures.reset();
  }

  function zoomOut() {
    const target = [...ZOOM_LEVELS].reverse().find((level) => level < zoomPercent) ?? ZOOM_LEVELS[0];
    explorerGestures.zoomTo(target / 100);
  }

  function zoomIn() {
    const target = ZOOM_LEVELS.find((level) => level > zoomPercent) ?? ZOOM_LEVELS.at(-1);
    explorerGestures.zoomTo(target / 100);
  }

  function resetView() {
    explorerGestures.reset();
  }
</script>

<section class="markdown-artifact">
  {#if exploredDiagram}
    <section class="mermaid-explorer" aria-label={exploredLabel}>
      <header class="mermaid-explorer-toolbar">
        <div class="mermaid-explorer-heading">
          <strong>Diagram explorer</strong>
          <span class="mermaid-explorer-hint">Drag or swipe to pan · pinch or Ctrl-wheel to zoom · double-tap/click to center</span>
          <span class="mermaid-explorer-zoom" role="status" aria-live="polite" aria-atomic="true">{zoomPercent}%</span>
        </div>
        <div class="mermaid-explorer-actions" role="group" aria-label="Diagram zoom controls">
          <button type="button" class="chip" onclick={zoomOut} disabled={!canZoomOut} aria-label="Zoom out">−</button>
          <button type="button" class="chip" onclick={resetView} disabled={zoomPercent === 100 && viewTransform.x === 0 && viewTransform.y === 0}>Center</button>
          <button type="button" class="chip" onclick={zoomIn} disabled={!canZoomIn} aria-label="Zoom in">+</button>
          <button type="button" class="chip mermaid-explorer-close" onclick={closeExplorer}>Back to reader</button>
        </div>
      </header>
      <div
        class="mermaid-explorer-viewport"
        role="region"
        aria-label="Interactive Mermaid diagram; drag or swipe to pan and pinch or Control-wheel to zoom"
        onpointerdown={explorerGestures.pointerDown}
        onpointermove={explorerGestures.pointerMove}
        onpointerup={explorerGestures.pointerUp}
        onpointercancel={explorerGestures.pointerCancel}
        onwheel={explorerGestures.wheel}
        ondblclick={explorerGestures.doubleClick}
      >
        <div
          class="mermaid-explorer-canvas"
          style:--mermaid-render-size={`${viewTransform.scale * 100}%`}
          style:--mermaid-pan-x={`${viewTransform.x}px`}
          style:--mermaid-pan-y={`${viewTransform.y}px`}
        >
          <SanitizedMarkdown
            className="pinned-markdown-viewer mermaid-explorer-render"
            source={exploredMarkdown}
            label={exploredLabel}
            enableMermaid={true}
          />
        </div>
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

  .mermaid-explorer-hint {
    color: var(--muted);
    font: 9px/1.35 var(--mono);
  }

  .mermaid-explorer-zoom {
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
    display: grid;
    min-width: 0;
    min-height: 0;
    flex: 1;
    place-items: center;
    overflow: hidden;
    cursor: grab;
    overscroll-behavior: contain;
    touch-action: none;
    user-select: none;
  }

  .mermaid-explorer-viewport:active {
    cursor: grabbing;
  }

  .mermaid-explorer-canvas {
    display: grid;
    width: var(--mermaid-render-size);
    height: var(--mermaid-render-size);
    flex: none;
    transform: translate(var(--mermaid-pan-x), var(--mermaid-pan-y));
  }

  @media (max-width: 620px) {
    .mermaid-explorer-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .mermaid-explorer-heading {
      flex-wrap: wrap;
    }

    .mermaid-explorer-hint {
      width: 100%;
      order: 3;
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
