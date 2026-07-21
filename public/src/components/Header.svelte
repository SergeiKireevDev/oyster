<script>
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
  <span class="dot" id="connDot"></span>
  <span class="title" id="sessionTitle">pi-lot</span>
  <span class="spacer"></span>
  <span class="chip" id="hublotChip" title="Show hublots">❖</span>
  <span class="chip" id="treeChip" title="Checkpoints & forks tree">⎇</span>
  <span class="chip" id="cfgChip" title="Model & thinking level">model · think</span>
  <span class="chip" id="modelChip" title="Change model">model</span>
  <span class="chip" id="thinkChip" title="Cycle thinking level">think</span>
  <span class="chip" id="menuBtn" role="button" tabindex="0" onclick={toggleMenu} onkeydown={onMenuKeydown}>☰</span>
</header>
