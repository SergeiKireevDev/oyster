<script>
  import PinnedWidgetGrid from "./PinnedWidgetGrid.svelte";
  import RoutineList from "./RoutineList.svelte";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HUBLOT_SHOW_ACTION,
    PINNED_WIDGET_CREATE_GROUP_ACTION,
    PINNED_WIDGET_PIN_LINK_ACTION,
    ROUTINE_SHOW_GENERATOR_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const showWidgetManager = () => uiActions.invoke(HUBLOT_SHOW_ACTION);
  const createGroup = () => uiActions.invoke(PINNED_WIDGET_CREATE_GROUP_ACTION);
  const pinLink = () => uiActions.invoke(PINNED_WIDGET_PIN_LINK_ACTION);
  const showRoutineGenerator = () => uiActions.invoke(ROUTINE_SHOW_GENERATOR_ACTION);
</script>

<aside id="hublots" aria-label="Pinned widgets and routines">
  <div class="side-head">Pinned Widgets</div>
  <PinnedWidgetGrid />
  <div class="pinned-widget-add-actions">
    <button type="button" id="hublotAdd" title="Pin an artifact or create a live interface" onclick={showWidgetManager}>+</button>
    <button type="button" title="Create a widget group" onclick={createGroup}>Group</button>
    <button type="button" title="Pin an HTTPS link" onclick={pinLink}>Link</button>
  </div>
  <div class="side-head routines">Routines</div>
  <RoutineList />
  <button type="button" id="routineAdd" title="Build a new routine" onclick={showRoutineGenerator}>+</button>
</aside>
