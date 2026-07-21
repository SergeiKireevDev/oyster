<script>
  import { appHeader } from "../stores/appSession.js";
  import { menuOpen } from "../stores/ui.js";
  import { runHeaderAction } from "../features/settings/headerActions.js";

  function toggleMenu(event) {
    event.stopPropagation();
    menuOpen.update((open) => !open);
  }
</script>

<header>
  <span class={$appHeader.connectionClass} id="connDot"></span>
  <span class="title" id="sessionTitle">{$appHeader.sessionTitle}</span>
  <span class="spacer"></span>
  <button class="chip" id="hublotChip" title="Show hublots" onclick={(event) => runHeaderAction("toggleHublots", event)}>❖</button>
  <button class="chip" id="treeChip" title="Checkpoints & forks tree" onclick={(event) => runHeaderAction("toggleTree", event)}>⎇</button>
  <button class="chip" id="cfgChip" title="Model & thinking level" onclick={() => runHeaderAction("openConfig")}>{$appHeader.cfgChip}</button>
  <button class="chip" id="modelChip" title="Change model" onclick={() => runHeaderAction("chooseModel")}>{$appHeader.modelChip}</button>
  <button class="chip" id="thinkChip" title="Cycle thinking level" onclick={() => runHeaderAction("cycleThinking")}>{$appHeader.thinkChip}</button>
  <button class="chip" id="menuBtn" aria-label="Open menu" onclick={toggleMenu}>☰</button>
</header>
