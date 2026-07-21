<script>
  import {
    chooseHeaderModel,
    cycleHeaderThinking,
    openHeaderConfig,
    toggleHeaderHublots,
    toggleHeaderTree,
  } from "../lib/legacyBridge.js";
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
  <span class="chip" id="hublotChip" title="Show hublots" role="button" tabindex="0" onclick={toggleHeaderHublots} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") toggleHeaderHublots(event); }}>❖</span>
  <span class="chip" id="treeChip" title="Checkpoints & forks tree" role="button" tabindex="0" onclick={toggleHeaderTree} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") toggleHeaderTree(event); }}>⎇</span>
  <span class="chip" id="cfgChip" title="Model & thinking level" role="button" tabindex="0" onclick={openHeaderConfig} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") openHeaderConfig(); }}>{$headerState.cfgChip}</span>
  <span class="chip" id="modelChip" title="Change model" role="button" tabindex="0" onclick={chooseHeaderModel} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") chooseHeaderModel(); }}>{$headerState.modelChip}</span>
  <span class="chip" id="thinkChip" title="Cycle thinking level" role="button" tabindex="0" onclick={cycleHeaderThinking} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") cycleHeaderThinking(); }}>{$headerState.thinkChip}</span>
  <span class="chip" id="menuBtn" role="button" tabindex="0" onclick={toggleMenu} onkeydown={onMenuKeydown}>☰</span>
</header>
