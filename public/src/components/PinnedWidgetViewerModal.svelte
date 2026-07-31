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

<section class="pinned-widget-viewer">
  {#if widget.kind === "markdown"}
    <div class="pinned-markdown-toolbar">
      <span>Markdown preview</span>
      <button
        type="button"
        class="chip"
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
        <MarkdownArtifact source={widget.content ?? ""} label={widget.label} />
      {:else if widget.kind === "monitoring"}
        <MonitoringArtifact content={widget.content ?? ""} format={widget.format ?? "text"} />
      {:else if isHtml}
        <HtmlArtifact src={htmlSource} label={widget.label} />
      {:else}
        <p class="pinned-widget-unavailable" role="status">A preview is not available for this artifact.</p>
      {/if}
    </div>
  {/key}

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
        >←</button>
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
        >→</button>
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
</section>
