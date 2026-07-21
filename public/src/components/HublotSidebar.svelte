<script>
  import HublotList from "./HublotList.svelte";
  import RoutineList from "./RoutineList.svelte";
</script>

<aside id="hublots">
  <div class="side-head">Hublots</div>
  <HublotList />
  <div id="hublotAdd" title="Open a new hublot">+</div>
  <div class="side-head routines">Routines</div>
  <RoutineList />
</aside>
