<script>
  import CarouselDots from "./CarouselDots.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import SettingsModal from "./SettingsModal.svelte";
  import Toasts from "./Toasts.svelte";
  import { closeModalState, modalState } from "../stores/modal.js";
</script>

<CarouselDots />

<div id="overlay" class:open={$modalState.open}><div id="modal" class:wide={$modalState.wide}>
  <div class="m-title" id="mTitle">{$modalState.title}</div>
  <div class="m-body" id="mBody">
    {#if $modalState.content === "settings"}
      <SettingsModal />
    {/if}
  </div>
  <div class="m-actions" id="mActions">
    {#if $modalState.content === "settings"}
      <button class="btn" onclick={closeModalState}>Done</button>
    {/if}
  </div>
</div></div>

<Toasts />

<CommandPalette />
