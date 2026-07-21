<script>
  import HublotList from "./HublotList.svelte";
  import RoutineList from "./RoutineList.svelte";
  import { showHublots as showHublotManager } from "../features/hublots/hublotActions.js";
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
