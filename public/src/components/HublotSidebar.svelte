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
  <button type="button" id="hublotAdd" title="Open a new hublot" onclick={showHublotManager}>+</button>
  <div class="side-head routines">Routines</div>
  <RoutineList />
</aside>
