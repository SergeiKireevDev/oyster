<script>
  import { onDestroy } from "svelte";
  import HtmlArtifact from "./HtmlArtifact.svelte";
  import ImageArtifact from "./ImageArtifact.svelte";
  import SvgArtifact from "./SvgArtifact.svelte";
  import VideoArtifact from "./VideoArtifact.svelte";
  import MarkdownArtifact from "./MarkdownArtifact.svelte";
  import MonitoringArtifact from "./MonitoringArtifact.svelte";
  import { closeModalState, modalState } from "../stores/modal.js";
  import { copyTextToClipboard } from "../lib/clipboardController.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { PINNED_WIDGET_OPEN_ACTION, PINNED_WIDGET_REVEAL_ACTION } from "../runtime/uiActionNames.js";
  import { createAsyncRequestGuard } from "../lib/asyncRequestGuard.js";
  import { pinnedWidgets } from "../stores/pinnedWidgets.js";
  import { buildPinnedWidgetViewerNavigation } from "../features/pinned-widgets/pinnedWidgetViewModel.js";

  const COPY_FEEDBACK_DURATION_MS = 1_800;
  const COPY_RAW_LABELS = {
    idle: "Copy raw",
    copying: "Copying…",
    copied: "Copied",
    failed: "Copy failed",
  };
  const EMPTY_WIDGET = Object.freeze({});
  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const copyRequests = createAsyncRequestGuard();

  let copyFeedback = $state({ widgetId: null, status: "idle" });
  let diagramExplorerWidgetId = $state(null);
  let copyRawTimer;
  const widget = $derived($modalState.context?.widget ?? EMPTY_WIDGET);
  const source = $derived(widget.id ? browserActions.pinnedWidgetMediaSource(widget.id) : "");
  const htmlSource = $derived(widget.id ? browserActions.pinnedWidgetHtmlSource(widget.id) : "");
  const download = $derived(widget.path ? browserActions.fileDownload(widget.path) : null);
  const isHtml = $derived(String(widget.mimeType ?? "").startsWith("text/html"));
  const navigation = $derived(buildPinnedWidgetViewerNavigation($pinnedWidgets, widget.id));
  const copyRawState = $derived(copyFeedback.widgetId === widget.id ? copyFeedback.status : "idle");
  const copyRawLabel = $derived(COPY_RAW_LABELS[copyRawState] ?? COPY_RAW_LABELS.idle);
  const copyRawDisabled = $derived(copyRawState === "copying");
  const copyRawSucceeded = $derived(copyRawState === "copied");
  const copyRawFailed = $derived(copyRawState === "failed");
  const previewLabel = $derived(`${widget.label || "Pinned widget"} preview`);
  const diagramExplorerActive = $derived(diagramExplorerWidgetId === widget.id);

  function setDiagramExplorerActive(active) {
    diagramExplorerWidgetId = active ? widget.id : null;
  }

  function openAdjacentWidget(target) {
    if (!target) return;
    uiActions.invoke(PINNED_WIDGET_OPEN_ACTION, target);
  }

  function revealWidget() {
    uiActions.invoke(PINNED_WIDGET_REVEAL_ACTION, widget);
  }

  async function copyRawMarkdown() {
    const request = copyRequests.begin();
    const widgetId = widget.id;
    clearTimeout(copyRawTimer);
    copyFeedback = { widgetId, status: "copying" };

    try {
      const copied = await copyTextToClipboard(String(widget.content ?? ""));
      if (!request.isCurrent()) return;
      copyFeedback = { widgetId, status: copied ? "copied" : "failed" };
    } catch {
      if (!request.isCurrent()) return;
      copyFeedback = { widgetId, status: "failed" };
    }

    copyRawTimer = setTimeout(() => {
      if (request.isCurrent()) copyFeedback = { widgetId, status: "idle" };
    }, COPY_FEEDBACK_DURATION_MS);
  }

  onDestroy(() => {
    copyRequests.invalidate();
    clearTimeout(copyRawTimer);
  });
</script>

<section class="pinned-widget-viewer" class:diagram-explorer-active={diagramExplorerActive}>
  {#if widget.kind === "markdown" && !diagramExplorerActive}
    <div class="pinned-markdown-toolbar">
      <span>Markdown preview</span>
      <button
        type="button"
        class="chip copy-raw-action"
        class:copy-success={copyRawSucceeded}
        class:copy-error={copyRawFailed}
        disabled={copyRawDisabled}
        onclick={copyRawMarkdown}
        aria-live="polite"
        aria-atomic="true"
      >{copyRawLabel}</button>
    </div>
  {:else if widget.kind === "monitoring"}
    <div class="pinned-markdown-toolbar">
      <span>Live snapshot · {widget.format === "diff" ? "diff" : "text"}</span>
    </div>
  {/if}

  {#key widget.id}
    <div
      class="pinned-widget-viewer-stage"
      class:markdown-stage={widget.kind === "markdown"}
      class:monitoring-stage={widget.kind === "monitoring"}
      class:html-stage={isHtml}
      role="region"
      aria-label={previewLabel}
    >
      {#if widget.availability !== "ready"}
        <p class="pinned-widget-unavailable" role="status">This artifact is no longer available.</p>
      {:else if widget.kind === "image" && widget.mimeType === "image/svg+xml"}
        <SvgArtifact src={source} alt={widget.label} />
      {:else if widget.kind === "image"}
        <ImageArtifact src={source} alt={widget.label} />
      {:else if widget.kind === "video"}
        <VideoArtifact src={source} label={widget.label} autoplay={true} />
      {:else if widget.kind === "markdown"}
        <MarkdownArtifact source={widget.content ?? ""} label={widget.label} onExploreChange={setDiagramExplorerActive} />
      {:else if widget.kind === "monitoring"}
        <MonitoringArtifact content={widget.content ?? ""} format={widget.format ?? "text"} />
      {:else if isHtml}
        <HtmlArtifact src={htmlSource} label={widget.label} />
      {:else}
        <p class="pinned-widget-unavailable" role="status">A preview is not available for this artifact.</p>
      {/if}
    </div>
  {/key}

  {#if !diagramExplorerActive}
    <div class="m-actions pinned-widget-viewer-actions">
      {#if navigation.total > 1}
        <div class="pinned-widget-viewer-navigation" role="group" aria-label="Pinned widget navigation">
          <button
            type="button"
            class="chip pinned-widget-viewer-arrow"
            aria-label="Previous pinned widget"
            title={navigation.previous ? `Previous: ${navigation.previous.label}` : "No previous pinned widget"}
            disabled={!navigation.previous}
            onclick={() => openAdjacentWidget(navigation.previous)}
          ><span aria-hidden="true">←</span></button>
          <span role="status" aria-live="polite" aria-atomic="true">
            {navigation.index + 1} / {navigation.total}
          </span>
          <button
            type="button"
            class="chip pinned-widget-viewer-arrow"
            aria-label="Next pinned widget"
            title={navigation.next ? `Next: ${navigation.next.label}` : "No next pinned widget"}
            disabled={!navigation.next}
            onclick={() => openAdjacentWidget(navigation.next)}
          ><span aria-hidden="true">→</span></button>
        </div>
      {/if}
      {#if download}
        <a class="chip" href={download.href} download={download.filename}>Download</a>
      {/if}
      {#if widget.path}
        <button type="button" class="chip" onclick={revealWidget}>Reveal in Files</button>
      {/if}
      <button type="button" class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
    </div>
  {/if}
</section>

<style>
  .pinned-widget-viewer {
    display: flex;
    min-width: 0;
    min-height: min(70vh, 680px);
    flex-direction: column;
  }

  .pinned-markdown-toolbar {
    display: flex;
    min-width: 0;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px 8px;
    color: var(--muted);
    font-size: 11px;
  }

  .pinned-markdown-toolbar > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned-markdown-toolbar .chip {
    min-height: 30px;
    flex: none;
    padding: 5px 11px;
    font-size: 11px;
  }

  .copy-raw-action.copy-success {
    border-color: color-mix(in srgb, var(--green) 44%, var(--border));
    color: var(--green);
  }

  .copy-raw-action.copy-error {
    border-color: color-mix(in srgb, var(--red) 48%, var(--border));
    color: var(--red);
  }

  .pinned-widget-viewer-stage {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    flex: 1;
    place-items: center;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg) 92%, var(--panel));
  }

  .pinned-widget-viewer-stage.markdown-stage,
  .pinned-widget-viewer-stage.monitoring-stage {
    display: block;
    overscroll-behavior: contain;
    background: var(--bg);
  }

  .pinned-widget-viewer-stage.markdown-stage {
    scrollbar-gutter: stable;
  }

  .pinned-widget-viewer-stage.monitoring-stage {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
  }

  .pinned-widget-viewer-stage.html-stage {
    display: block;
    background: #fff;
  }

  .diagram-explorer-active .pinned-widget-viewer-stage {
    border: 0;
    border-radius: 0;
  }

  .pinned-widget-unavailable {
    max-width: min(34ch, calc(100% - 32px));
    margin: 16px;
    padding: 12px 14px;
    border: 1px dashed var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    color: var(--muted);
    line-height: 1.45;
    text-align: center;
  }

  .pinned-widget-viewer-actions {
    padding-top: 12px;
  }

  .pinned-widget-viewer-navigation {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 7px;
    margin-right: auto;
    color: var(--muted);
    font: 11px/1 var(--mono);
  }

  .pinned-widget-viewer-navigation > span {
    min-width: 4.5ch;
    text-align: center;
  }

  @media (max-width: 760px) {
    .pinned-markdown-toolbar {
      min-height: 40px;
      padding: 0 2px 6px;
    }

    .pinned-markdown-toolbar .chip,
    .pinned-widget-viewer-actions > .chip {
      min-height: 40px;
    }

    .pinned-widget-viewer {
      min-height: calc(100dvh - 130px);
    }

    .pinned-widget-viewer-stage {
      border-radius: 8px;
    }
  }

  @media (max-width: 520px) {
    .pinned-widget-viewer-navigation {
      width: 100%;
      justify-content: center;
      margin-right: 0;
    }

    .pinned-widget-viewer-actions > .chip {
      flex: 1 1 calc(50% - 3px);
      justify-content: center;
      text-align: center;
    }
  }
</style>
