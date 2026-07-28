<script>
  import { onDestroy } from "svelte";
  import HtmlArtifact from "./HtmlArtifact.svelte";
  import ImageArtifact from "./ImageArtifact.svelte";
  import SvgArtifact from "./SvgArtifact.svelte";
  import VideoArtifact from "./VideoArtifact.svelte";
  import MarkdownArtifact from "./MarkdownArtifact.svelte";
  import { closeModalState, modalState } from "../stores/modal.js";
  import { pinnedWidgetMediaUrl } from "../lib/pinnedWidgetActions.js";
  import { copyTextToClipboard } from "../lib/clipboardController.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { PINNED_WIDGET_REVEAL_ACTION } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  $: widget = $modalState.context?.widget ?? {};
  $: source = widget.id ? pinnedWidgetMediaUrl(widget.id) : "";
  $: download = widget.path ? browserActions.fileDownload(null, widget.path) : null;
  $: isHtml = String(widget.mimeType ?? "").startsWith("text/html");
  let copyRawState = "idle";
  let copyRawTimer;

  async function copyRawMarkdown() {
    clearTimeout(copyRawTimer);
    copyRawState = await copyTextToClipboard(String(widget.content ?? "")) ? "copied" : "failed";
    copyRawTimer = setTimeout(() => { copyRawState = "idle"; }, 1800);
  }

  onDestroy(() => clearTimeout(copyRawTimer));
</script>

<section class="pinned-widget-viewer">
  {#if widget.kind === "markdown"}
    <div class="pinned-markdown-toolbar">
      <span>Markdown preview</span>
      <button type="button" class="chip" onclick={copyRawMarkdown} aria-live="polite">
        {copyRawState === "copied" ? "Copied" : copyRawState === "failed" ? "Copy failed" : "Copy raw"}
      </button>
    </div>
  {/if}
  <div class="pinned-widget-viewer-stage" class:markdown-stage={widget.kind === "markdown"} class:html-stage={isHtml}>
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
    {:else if isHtml}
      <HtmlArtifact source={widget.content ?? ""} label={widget.label} />
    {/if}
  </div>
  <div class="m-actions pinned-widget-viewer-actions">
    {#if download}<a class="chip" href={download.href} download={download.filename}>Download</a>{/if}
    {#if widget.path}<button class="chip" onclick={() => uiActions.invoke(PINNED_WIDGET_REVEAL_ACTION, widget)}>Reveal in Files</button>{/if}
    <button class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
  </div>
</section>
