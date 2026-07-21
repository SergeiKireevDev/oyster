<script>
  import { appHeader } from "../stores/appSession.js";
  import { menuOpen } from "../stores/ui.js";

  function runHeaderAction(action, sourceEvent = null) {
    document.dispatchEvent(new CustomEvent("pi:header", { detail: { action, sourceEvent } }));
  }

  function onActionKeydown(event, action) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runHeaderAction(action, event);
    }
  }

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
  <span class={$appHeader.connectionClass} id="connDot"></span>
  <span class="title" id="sessionTitle">{$appHeader.sessionTitle}</span>
  <span class="spacer"></span>
  <span class="chip" id="hublotChip" title="Show hublots" role="button" tabindex="0" onclick={(event) => runHeaderAction("toggleHublots", event)} onkeydown={(event) => onActionKeydown(event, "toggleHublots")}>❖</span>
  <span class="chip" id="treeChip" title="Checkpoints & forks tree" role="button" tabindex="0" onclick={(event) => runHeaderAction("toggleTree", event)} onkeydown={(event) => onActionKeydown(event, "toggleTree")}>⎇</span>
  <span class="chip" id="cfgChip" title="Model & thinking level" role="button" tabindex="0" onclick={() => runHeaderAction("openConfig")} onkeydown={(event) => onActionKeydown(event, "openConfig")}>{$appHeader.cfgChip}</span>
  <span class="chip" id="modelChip" title="Change model" role="button" tabindex="0" onclick={() => runHeaderAction("chooseModel")} onkeydown={(event) => onActionKeydown(event, "chooseModel")}>{$appHeader.modelChip}</span>
  <span class="chip" id="thinkChip" title="Cycle thinking level" role="button" tabindex="0" onclick={() => runHeaderAction("cycleThinking")} onkeydown={(event) => onActionKeydown(event, "cycleThinking")}>{$appHeader.thinkChip}</span>
  <span class="chip" id="menuBtn" role="button" tabindex="0" onclick={toggleMenu} onkeydown={onMenuKeydown}>☰</span>
</header>
