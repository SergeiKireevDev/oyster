<script>
  import { onMount } from "svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import CarouselIndicator from "./CarouselIndicator.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import Toasts from "./Toasts.svelte";
  import { createModalHistoryController } from "../lib/modalHistoryController.js";
  import { modalFocusManagement, modalKeyboardNavigation, requestModalCancel } from "../lib/modalDomAdapters.js";
  import { resolveModalContent } from "../runtime/modalContentRegistry.js";
  import { carouselPage } from "../stores/carousel.js";
  import { modalState } from "../stores/modal.js";

  const FOLDER_MODAL_CONTENTS = new Set(["fileExplorer", "filePicker", "folderBrowser"]);
  const MARKDOWN_WIDGET_KINDS = new Set(["markdown", "monitoring"]);

  /**
   * @param {unknown} content
   * @param {{ widget?: { kind?: unknown; mimeType?: unknown } } | null | undefined} context
   */
  function isMarkdownReader(content, context) {
    if (content !== "pinnedWidgetViewer") return false;
    const widget = context?.widget;
    return MARKDOWN_WIDGET_KINDS.has(widget?.kind)
      || String(widget?.mimeType ?? "").startsWith("text/html");
  }

  /** @type {HTMLDivElement | undefined} */
  let overlayElement = $state();
  let modalContent = $derived(resolveModalContent($modalState.content, $modalState.context));
  let hasFolderTitleIcon = $derived(FOLDER_MODAL_CONTENTS.has($modalState.content));
  let isMarkdownReaderModal = $derived(isMarkdownReader($modalState.content, $modalState.context));

  onMount(() => {
    const overlay = overlayElement;
    const windowTarget = overlay?.ownerDocument.defaultView;
    if (!overlay || !windowTarget) return;

    const controller = createModalHistoryController({
      windowTarget,
      subscribe: modalState.subscribe,
      isOpen: () => $modalState.open,
      cancel: () => requestModalCancel(overlay),
    });
    return controller.detach;
  });
</script>

<CarouselIndicator page={$carouselPage} />

<div
  id="overlay"
  bind:this={overlayElement}
  class:open={$modalState.open}
  use:modalKeyboardNavigation={{ isOpen: () => $modalState.open, content: () => $modalState.content }}
>
  <div
    id="modal"
    class:wide={$modalState.wide}
    class:markdown-reader-modal={isMarkdownReaderModal}
    role="dialog"
    aria-modal={$modalState.open ? "true" : undefined}
    aria-hidden={$modalState.open ? undefined : "true"}
    aria-labelledby="mTitle"
    inert={!$modalState.open}
    tabindex="-1"
    use:modalFocusManagement={{ open: $modalState.open, identity: $modalState.content }}
  >
    <div class="m-title" id="mTitle">
      {#if hasFolderTitleIcon}<FolderIcon size={17} />{/if}
      <span>{$modalState.title}</span>
    </div>

    {#if $modalState.content === null}
      <div class="m-body" id="mBody"></div>
      <div class="m-actions" id="mActions"></div>
    {:else}
      <div class="m-body" id="mBody">
        {#if modalContent}
          {@const ModalComponent = modalContent.component}
          <ModalComponent {...modalContent.props} />
        {/if}
      </div>
    {/if}
  </div>
</div>

<Toasts />

<CommandPalette />
