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

  const folderModalContents = new Set(["fileExplorer", "filePicker", "folderBrowser"]);
  let modalElement;
  let overlayElement;

  $: modalContent = resolveModalContent($modalState.content, $modalState.context);
  $: hasFolderTitleIcon = folderModalContents.has($modalState.content);
  $: isMarkdownReaderModal = $modalState.content === "pinnedWidgetViewer" && (
    ["markdown", "monitoring"].includes($modalState.context?.widget?.kind)
    || String($modalState.context?.widget?.mimeType ?? "").startsWith("text/html")
  );

  onMount(() => {
    const controller = createModalHistoryController({
      windowTarget: modalElement.ownerDocument.defaultView,
      subscribe: modalState.subscribe,
      isOpen: () => $modalState.open,
      cancel: () => requestModalCancel(overlayElement),
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
><div
  id="modal"
  class:wide={$modalState.wide}
  class:markdown-reader-modal={isMarkdownReaderModal}
  role="dialog"
  aria-modal={$modalState.open ? "true" : undefined}
  aria-hidden={$modalState.open ? undefined : "true"}
  aria-labelledby="mTitle"
  tabindex="-1"
  bind:this={modalElement}
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
        <svelte:component this={modalContent.component} {...modalContent.props} />
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
