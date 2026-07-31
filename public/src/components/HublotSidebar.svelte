<script>
  import PinnedWidgetGrid from "./PinnedWidgetGrid.svelte";
  import RoutineList from "./RoutineList.svelte";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HUBLOT_SHOW_ACTION,
    ROUTINE_SHOW_GENERATOR_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const showWidgetManager = () => uiActions.invoke(HUBLOT_SHOW_ACTION);
  const showRoutineGenerator = () => uiActions.invoke(ROUTINE_SHOW_GENERATOR_ACTION);
</script>

<aside id="hublots" aria-label="Pinned widgets and routines">
  <div class="side-head">Pinned Widgets</div>
  <PinnedWidgetGrid />
  <div class="pinned-widget-add-actions">
    <button type="button" id="hublotAdd" title="Create a custom widget from a prompt" onclick={showWidgetManager}>Add custom from prompt</button>
  </div>
  <div class="side-head routines">Routines</div>
  <RoutineList />
  <button type="button" id="routineAdd" title="Build a new routine" aria-label="Build a new routine" onclick={showRoutineGenerator}>+</button>
</aside>
