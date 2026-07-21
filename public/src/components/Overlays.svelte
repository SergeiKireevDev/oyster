<script>
  import CarouselIndicator from "./CarouselIndicator.svelte";
  import CheckpointModelPickerModal from "./CheckpointModelPickerModal.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ConfirmPromptModal from "./ConfirmPromptModal.svelte";
  import EditorPromptModal from "./EditorPromptModal.svelte";
  import FileExplorerModal from "./FileExplorerModal.svelte";
  import FilePickerModal from "./FilePickerModal.svelte";
  import FolderBrowserModal from "./FolderBrowserModal.svelte";
  import HublotManagerModal from "./HublotManagerModal.svelte";
  import OptionPickerModal from "./OptionPickerModal.svelte";
  import SettingsModal from "./SettingsModal.svelte";
  import SessionPickerModal from "./SessionPickerModal.svelte";
  import TextPromptModal from "./TextPromptModal.svelte";
  import Toasts from "./Toasts.svelte";
  import { modalState } from "../stores/modal.js";

  const optionSelector = "button.m-option:not(:disabled), .session-row > button.s-session-main:not(:disabled), label.m-option";
  let keyboardOption = null;
  let modalElement;

  $: if ($modalState.open && modalElement) {
    queueMicrotask(() => {
      if ($modalState.open && !modalElement.contains(modalElement.ownerDocument.activeElement)) modalElement.focus();
    });
  }

  function optionsIn(overlay) {
    return [...overlay.querySelectorAll(optionSelector)].filter((option) => option.getClientRects().length > 0);
  }

  function activateOption(option) {
    keyboardOption?.closest(".m-option")?.classList.remove("keyboard-active");
    keyboardOption = option;
    keyboardOption?.closest(".m-option")?.classList.add("keyboard-active");
    keyboardOption?.scrollIntoView({ block: "nearest" });
  }

  function cancelModal(overlay) {
    const explicit = overlay.querySelector("[data-modal-cancel]");
    if (explicit) { explicit.click(); return; }
    const fallback = [...overlay.querySelectorAll("button")].find((button) => /^(cancel|close|done|no)$/i.test(button.textContent.trim()));
    fallback?.click();
  }

  function modalKeydown(event) {
    if (!$modalState.open) return;
    const overlay = event.currentTarget;
    if (event.key === "Enter" && overlay.clientWidth <= 760) {
      event.preventDefault();
      event.stopPropagation();
      cancelModal(overlay);
      return;
    }
    if ($modalState.content === "optionPicker") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelModal(overlay);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (event.target.matches?.("textarea, select, [contenteditable=true]") || (event.key === "Enter" && event.target.matches?.("input, button"))) return;
    const options = optionsIn(overlay);
    if (!options.length) {
      const primary = event.key === "Enter" ? overlay.querySelector(".m-actions button.btn:not(:disabled)") : null;
      if (!primary) return;
      event.preventDefault();
      event.stopPropagation();
      primary.click();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") {
      const selected = options.includes(keyboardOption) ? keyboardOption : event.target.closest?.(optionSelector) ?? options[0];
      selected?.click();
      return;
    }
    const current = options.indexOf(keyboardOption);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : (current + direction + options.length) % options.length;
    activateOption(options[next]);
  }

  function modalMousemove(event) {
    const option = event.target.closest?.(optionSelector);
    if (option && event.currentTarget.contains(option)) activateOption(option);
  }
</script>

<CarouselIndicator />

<div id="overlay" class:open={$modalState.open} onkeydowncapture={modalKeydown} onmousemove={modalMousemove}><div id="modal" class:wide={$modalState.wide} role="dialog" aria-modal="true" tabindex="-1" bind:this={modalElement}>
  <div class="m-title" id="mTitle">{$modalState.title}</div>

  {#if $modalState.content === null}
    <div class="m-body" id="mBody"></div>
    <div class="m-actions" id="mActions"></div>
  {:else}
    <div class="m-body" id="mBody">
      {#if $modalState.content === "settings"}
        <SettingsModal />
      {:else if $modalState.content === "optionPicker"}
        <OptionPickerModal />
      {:else if $modalState.content === "textPrompt"}
        <TextPromptModal />
      {:else if $modalState.content === "editorPrompt"}
        <EditorPromptModal />
      {:else if $modalState.content === "confirmPrompt"}
        <ConfirmPromptModal />
      {:else if $modalState.content === "checkpointModelPicker"}
        <CheckpointModelPickerModal />
      {:else if $modalState.content === "hublotManager"}
        <HublotManagerModal />
      {:else if $modalState.content === "folderBrowser"}
        <FolderBrowserModal />
      {:else if $modalState.content === "filePicker"}
        <FilePickerModal />
      {:else if $modalState.content === "fileExplorer"}
        <FileExplorerModal />
      {:else if $modalState.content === "sessionPicker"}
        <SessionPickerModal />
      {/if}
    </div>
  {/if}
</div></div>

<Toasts />

<CommandPalette />
