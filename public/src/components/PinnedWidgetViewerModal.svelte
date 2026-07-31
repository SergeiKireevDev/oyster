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

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  $: widget = $modalState.context?.widget ?? {};
  $: source = widget.id ? browserActions.pinnedWidgetMediaSource(widget.id) : "";
  $: htmlSource = widget.id ? browserActions.pinnedWidgetHtmlSource(widget.id) : "";
  $: download = widget.path ? browserActions.fileDownload(widget.path) : null;
  $: isHtml = String(widget.mimeType ?? "").startsWith("text/html");
  $: navigation = buildPinnedWidgetViewerNavigation($pinnedWidgets, widget.id);
  $: copyRawLabel = copyRawState === "copied" ? "Copied" : copyRawState === "failed" ? "Copy failed" : "Copy raw";
  let copyRawState = "idle";
  let copyRawTimer;
  const copyRequests = createAsyncRequestGuard();

  function openAdjacentWidget(target) {
    if (target) uiActions.invoke(PINNED_WIDGET_OPEN_ACTION, target);
  }

  async function copyRawMarkdown() {
    const request = copyRequests.begin();
    clearTimeout(copyRawTimer);
    try {
      const copied = await copyTextToClipboard(String(widget.content ?? ""));
      if (!request.isCurrent()) return;
      copyRawState = copied ? "copied" : "failed";
    } catch {
      if (!request.isCurrent()) return;
      copyRawState = "failed";
    }
    copyRawTimer = setTimeout(() => { copyRawState = "idle"; }, 1800);
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
      <button type="button" class="chip" onclick={copyRawMarkdown} aria-live="polite">
        {copyRawLabel}
      </button>
    </div>
  {:else if widget.kind === "monitoring"}
    <div class="pinned-markdown-toolbar"><span>Live snapshot · {widget.format === "diff" ? "diff" : "text"}</span></div>
  {/if}
  <div class="pinned-widget-viewer-stage" class:markdown-stage={widget.kind === "markdown"} class:monitoring-stage={widget.kind === "monitoring"} class:html-stage={isHtml}>
    {#if widget.availability !== "ready"}
      <div class="pinned-widget-unavailable">This artifact is no longer available.</div>
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
    {/if}
  </div>
  <div class="m-actions pinned-widget-viewer-actions">
    {#if navigation.total > 1}
      <div class="pinned-widget-viewer-navigation" aria-label="Pinned widget navigation">
        <button
          type="button"
          class="chip pinned-widget-viewer-arrow"
          aria-label="Previous pinned widget"
          title={navigation.previous ? `Previous: ${navigation.previous.label}` : "No previous pinned widget"}
          disabled={!navigation.previous}
          onclick={() => openAdjacentWidget(navigation.previous)}
        >←</button>
        <span aria-live="polite">{navigation.index + 1} / {navigation.total}</span>
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
    {#if download}<a class="chip" href={download.href} download={download.filename}>Download</a>{/if}
    {#if widget.path}<button class="chip" onclick={() => uiActions.invoke(PINNED_WIDGET_REVEAL_ACTION, widget)}>Reveal in Files</button>{/if}
    <button class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
  </div>
</section>
