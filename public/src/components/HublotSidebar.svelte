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
  <section class="sidebar-section" aria-labelledby="pinned-widgets-heading">
    <h2 id="pinned-widgets-heading" class="side-head">Pinned Widgets</h2>
    <PinnedWidgetGrid />
    <div class="pinned-widget-add-actions">
      <button
        type="button"
        id="hublotAdd"
        title="Create a custom widget from a prompt"
        onclick={showWidgetManager}
      >Add custom from prompt</button>
    </div>
  </section>

  <section class="sidebar-section" aria-labelledby="routines-heading">
    <h2 id="routines-heading" class="side-head routines">Routines</h2>
    <RoutineList />
    <button
      type="button"
      id="routineAdd"
      title="Build a new routine"
      aria-label="Build a new routine"
      onclick={showRoutineGenerator}
    ><span aria-hidden="true">+</span></button>
  </section>
</aside>

<style>
  .sidebar-section {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 12px;
  }

  .side-head {
    margin: 0;
  }
</style>
