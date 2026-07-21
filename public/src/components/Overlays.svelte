<script>
  import CarouselDots from "./CarouselDots.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import Toasts from "./Toasts.svelte";
  import { modalState } from "../stores/modal.js";
</script>

<CarouselDots />

<div id="overlay" class:open={$modalState.open}><div id="modal" class:wide={$modalState.wide}>
  <div class="m-title" id="mTitle">{$modalState.title}</div>
  <div class="m-body" id="mBody"></div>
  <div class="m-actions" id="mActions"></div>
</div></div>

<Toasts />

<CommandPalette />
