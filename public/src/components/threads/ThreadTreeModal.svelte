<script>
  import { layoutThreadTree } from "../../features/threads/threadModel.js";
  import { scrollIntoViewWhen } from "../../lib/modalDomAdapters.js";
  import { getUiActionRegistry } from "../../runtime/uiActionContext.js";
  import { THREAD_NAVIGATE_ACTION } from "../../runtime/uiActionNames.js";
  import { closeModalState } from "../../stores/modal.js";
  import { threadView } from "../../stores/threads.js";

  /**
   * The family of the open session drawn as a tree: the root session on top,
   * one node per thread beneath the session it was opened from. Selecting a
   * node opens that session. The canvas scrolls natively (so touch panning
   * works) and scales with the zoom controls; the open session's node is
   * scrolled into view when the tree appears.
   */
  const ZOOM_STEP = 0.2;
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 1.6;
  const PADDING_PX = 24;
  const STATUS_LABELS = Object.freeze({ busy: "working", unread: "new reply", idle: "running", dormant: "" });

  const uiActions = getUiActionRegistry();
  let zoom = $state(1);

  const layout = $derived(layoutThreadTree($threadView, { currentSessionKey: $threadView.sessionKey }));
  const canvasWidth = $derived(layout.width + PADDING_PX * 2);
  const canvasHeight = $derived(layout.height + PADDING_PX * 2);
  const zoomLabel = $derived(`${Math.round(zoom * 100)}%`);
  const nodes = $derived(layout.nodes.map((node) => ({
    ...node,
    title: nodeTitle(node),
    meta: nodeMeta(node),
  })));

  function nodeMeta(node) {
    if (node.kind === "root") return "Main conversation";
    const size = node.messages ? `${node.messages} message${node.messages === 1 ? "" : "s"}` : "no reply yet";
    return STATUS_LABELS[node.status] ? `${size} · ${STATUS_LABELS[node.status]}` : size;
  }

  function nodeTitle(node) {
    const place = node.current ? " (open now)" : "";
    return node.kind === "root" ? `Main conversation: ${node.label}${place}` : `Thread: ${node.label} — “${node.snippet}”${place}`;
  }

  const open = (node) => uiActions.invoke(THREAD_NAVIGATE_ACTION, { sessionKey: node.sessionKey });
  const zoomBy = (delta) => { zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + delta) * 10) / 10)); };
  const zoomOut = () => zoomBy(-ZOOM_STEP);
  const zoomIn = () => zoomBy(ZOOM_STEP);
  const resetZoom = () => { zoom = 1; };
</script>

<div class="thread-tree">
  <!-- Always reachable: on a phone the tree fills the screen, leaving no backdrop to tap and no Escape key. -->
  <div class="thread-tree-bar">
    {#if nodes.length > 1}
      <div class="thread-tree-controls" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onclick={zoomOut}>−</button>
        <button type="button" class="thread-tree-zoom" title="Reset zoom" onclick={resetZoom}>{zoomLabel}</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onclick={zoomIn}>+</button>
      </div>
    {/if}
    <button type="button" class="thread-tree-close" data-modal-cancel aria-label="Close thread tree" title="Close" onclick={closeModalState}>✕</button>
  </div>
  {#if nodes.length <= 1}
    <p class="thread-tree-empty">No threads yet. Select text in a reply and pick a question to open one.</p>
  {:else}
    <div class="thread-tree-viewport">
      <div class="thread-tree-sizer" style:width={`${canvasWidth * zoom}px`} style:height={`${canvasHeight * zoom}px`}>
        <div class="thread-tree-canvas" style:width={`${canvasWidth}px`} style:height={`${canvasHeight}px`} style:transform={`scale(${zoom})`}>
          <svg class="thread-tree-edges" width={canvasWidth} height={canvasHeight} aria-hidden="true">
            <g transform={`translate(${PADDING_PX} ${PADDING_PX})`}>
              {#each layout.edges as edge (edge.id)}
                <path d={edge.path} />
              {/each}
            </g>
          </svg>
          {#each nodes as node (node.id)}
            <button
              type="button"
              class={`thread-node ${node.kind} status-${node.status}`}
              class:current={node.current}
              aria-current={node.current ? "page" : undefined}
              title={node.title}
              style:left={`${node.x + PADDING_PX}px`}
              style:top={`${node.y + PADDING_PX}px`}
              style:width={`${node.width}px`}
              style:height={`${node.height}px`}
              use:scrollIntoViewWhen={node.current}
              onclick={() => open(node)}
            >
              <span class="thread-node-heading">
                <span class="thread-node-dot" aria-hidden="true"></span>
                <span class="thread-node-label">{node.label}</span>
              </span>
              {#if node.snippet}<span class="thread-node-quote">“{node.snippet}”</span>{/if}
              <span class="thread-node-meta">{node.meta}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .thread-tree {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 10px;
  }

  .thread-tree-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .thread-tree-close {
    display: grid;
    width: 32px;
    height: 30px;
    flex: none;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }

  .thread-tree-close:hover { border-color: var(--accent); background: var(--surface-hover); }
  .thread-tree-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .thread-tree-empty { margin: 8px 0; color: var(--muted); font-size: 13.5px; }

  .thread-tree-controls {
    display: flex;
    gap: 4px;
  }

  .thread-tree-controls button {
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: 600 13px/1 inherit;
    cursor: pointer;
  }

  .thread-tree-controls button:hover:not(:disabled) { border-color: var(--accent); }
  .thread-tree-controls button:disabled { color: var(--muted); cursor: not-allowed; }
  .thread-tree-zoom { min-width: 54px; font-variant-numeric: tabular-nums; }

  .thread-tree-viewport {
    max-height: min(62vh, 640px);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg) 55%, var(--panel));
    overscroll-behavior: contain;
  }

  /* Reserves the scaled size so native scrolling covers the whole zoomed tree. */
  .thread-tree-sizer { min-width: 100%; }

  .thread-tree-canvas {
    position: relative;
    transform-origin: 0 0;
  }

  .thread-tree-edges { position: absolute; inset: 0; }

  .thread-tree-edges path {
    fill: none;
    stroke: color-mix(in srgb, var(--accent) 42%, var(--border));
    stroke-width: 1.5;
  }

  .thread-node {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 7px 11px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: border-color .14s ease, background .14s ease;
  }

  .thread-node:hover { border-color: var(--accent); background: var(--surface-hover); }
  .thread-node:focus-visible, .thread-tree-controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .thread-node.root { border-color: color-mix(in srgb, var(--text) 26%, var(--border)); }

  .thread-node.current {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 13%, var(--panel-2));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .thread-node-heading { display: flex; min-width: 0; align-items: center; gap: 7px; }

  .thread-node-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--stopped, var(--muted));
  }

  .status-idle .thread-node-dot { background: var(--green); }
  .status-busy .thread-node-dot { background: var(--yellow); }
  .status-unread .thread-node-dot { background: var(--accent); }

  .thread-node-label,
  .thread-node-quote,
  .thread-node-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-node-label { font-size: 13px; font-weight: 650; }
  .thread-node-quote { color: var(--text-secondary); font-size: 11.5px; }
  .thread-node-meta { color: var(--muted); font-size: 10.5px; }

  @media (max-width: 760px) {
    .thread-tree-viewport { max-height: calc(100dvh - 190px); }
    .thread-tree-controls button { min-width: 38px; height: 36px; }
    .thread-tree-close { width: 44px; height: 36px; font-size: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .thread-node { transition: none; }
  }
</style>
