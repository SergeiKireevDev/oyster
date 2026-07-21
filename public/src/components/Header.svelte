<script>
  import { headerState } from "../stores/header.js";
  import { menuOpen } from "../stores/ui.js";

  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }

  function onMenuKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMenu(event);
    }
  }
</script>

<header>
  <span class={$headerState.connectionClass} id="connDot"></span>
  <span class="title" id="sessionTitle">{$headerState.sessionTitle}</span>
  <span class="spacer"></span>
  <span class="chip" id="hublotChip" title="Show hublots">❖</span>
  <span class="chip" id="treeChip" title="Checkpoints & forks tree">⎇</span>
  <span class="chip" id="cfgChip" title="Model & thinking level">{$headerState.cfgChip}</span>
  <span class="chip" id="modelChip" title="Change model">{$headerState.modelChip}</span>
  <span class="chip" id="thinkChip" title="Cycle thinking level">{$headerState.thinkChip}</span>
  <span class="chip" id="menuBtn" role="button" tabindex="0" onclick={toggleMenu} onkeydown={onMenuKeydown}>☰</span>
</header>
