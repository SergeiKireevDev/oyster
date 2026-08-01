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
        class="chip sidebar-create-action"
        title="Create a custom widget from a prompt"
        onclick={showWidgetManager}
      >
        <span class="sidebar-create-icon" aria-hidden="true">+</span>
        <span>Add custom from prompt</span>
      </button>
    </div>
  </section>

  <section class="sidebar-section" aria-labelledby="routines-heading">
    <h2 id="routines-heading" class="side-head">Routines</h2>
    <RoutineList />
    <button
      type="button"
      id="routineAdd"
      class="chip sidebar-create-action"
      title="Build a new routine"
      aria-label="Build a new routine"
      onclick={showRoutineGenerator}
    >
      <span class="sidebar-create-icon" aria-hidden="true">+</span>
      <span>Build a new routine</span>
    </button>
  </section>
</aside>

<style>
  aside {
    min-width: 0;
    scrollbar-gutter: stable;
  }

  .sidebar-section {
    display: flex;
    min-width: 0;
    flex-shrink: 0;
    flex-direction: column;
    gap: 10px;
  }

  .side-head {
    margin: 0;
  }

  .pinned-widget-add-actions {
    display: grid;
    min-width: 0;
  }

  .sidebar-create-action {
    box-sizing: border-box;
    display: flex;
    width: 100%;
    height: auto;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 7px 10px;
    border-style: dashed;
    font-size: 10.5px;
    font-weight: 620;
    line-height: 1.25;
    text-align: center;
    white-space: normal;
  }

  .sidebar-create-icon {
    flex: none;
    color: var(--accent);
    font-size: 15px;
    font-weight: 500;
    line-height: 1;
  }

  @media (max-width: 760px) {
    aside {
      padding-bottom: calc(14px + env(safe-area-inset-bottom));
    }

    .sidebar-create-action {
      min-height: 42px;
      font-size: 11.5px;
    }
  }
</style>
