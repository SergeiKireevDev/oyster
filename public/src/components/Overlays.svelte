<script>
  import CarouselDots from "./CarouselDots.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ConfirmPromptModal from "./ConfirmPromptModal.svelte";
  import OptionPickerModal from "./OptionPickerModal.svelte";
  import SettingsModal from "./SettingsModal.svelte";
  import TextPromptModal from "./TextPromptModal.svelte";
  import Toasts from "./Toasts.svelte";
  import { closeModalState, modalState } from "../stores/modal.js";
  import { answerConfirmPrompt, cancelTextPrompt, submitTextPrompt } from "../stores/dialogs.js";
  import { cancelOptionPicker } from "../stores/optionPicker.js";
</script>

<CarouselDots />

<div id="overlay" class:open={$modalState.open}><div id="modal" class:wide={$modalState.wide}>
  <div class="m-title" id="mTitle">{$modalState.title}</div>
  <div class="m-body" id="mBody">
    {#if $modalState.content === "settings"}
      <SettingsModal />
    {:else if $modalState.content === "optionPicker"}
      <OptionPickerModal />
    {:else if $modalState.content === "textPrompt"}
      <TextPromptModal />
    {:else if $modalState.content === "confirmPrompt"}
      <ConfirmPromptModal />
    {/if}
  </div>
  <div class="m-actions" id="mActions">
    {#if $modalState.content === "settings"}
      <button class="btn" onclick={closeModalState}>Done</button>
    {:else if $modalState.content === "optionPicker"}
      <span
        class="chip"
        role="button"
        tabindex="0"
        onclick={cancelOptionPicker}
        onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelOptionPicker(); }}
      >Cancel</span>
    {:else if $modalState.content === "textPrompt"}
      <span class="chip" role="button" tabindex="0" onclick={cancelTextPrompt} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cancelTextPrompt(); }}>Cancel</span>
      <button class="btn" style="padding:6px 16px;" onclick={submitTextPrompt}>OK</button>
    {:else if $modalState.content === "confirmPrompt"}
      <span class="chip" role="button" tabindex="0" onclick={() => answerConfirmPrompt(false)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") answerConfirmPrompt(false); }}>No</span>
      <button class="btn" style="padding:6px 16px;" onclick={() => answerConfirmPrompt(true)}>Yes</button>
    {/if}
  </div>
</div></div>

<Toasts />

<CommandPalette />
