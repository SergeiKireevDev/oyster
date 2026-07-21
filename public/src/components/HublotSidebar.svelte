<script>
  import HublotList from "./HublotList.svelte";
  import RoutineList from "./RoutineList.svelte";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { HUBLOT_SHOW_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const showHublotManager = () => uiActions.invoke(HUBLOT_SHOW_ACTION);
</script>

<aside id="hublots">
  <div class="side-head">Hublots</div>
  <HublotList />
  <div id="hublotAdd" title="Open a new hublot" role="button" tabindex="0" onclick={showHublotManager} onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showHublotManager();
    }
  }}>+</div>
  <div class="side-head routines">Routines</div>
  <RoutineList />
</aside>
