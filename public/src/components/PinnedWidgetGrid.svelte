<script>
  import { onDestroy } from "svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import { createFrameScheduler } from "../lib/frameScheduler.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import {
    pinnedWidgetActiveGroup,
    pinnedWidgetGroups,
    pinnedWidgets,
    pinnedWidgetsError,
    pinnedWidgetsLoading,
  } from "../stores/pinnedWidgets.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { buildPinnedWidgetViewModel } from "../features/pinned-widgets/pinnedWidgetViewModel.js";
  import {
    PINNED_WIDGET_MANAGE_ACTION,
    PINNED_WIDGET_MOVE_ACTION,
    PINNED_WIDGET_MOVE_GROUP_ACTION,
    PINNED_WIDGET_OPEN_ACTION,
    PINNED_WIDGET_RENAME_GROUP_ACTION,
    PINNED_WIDGET_REFRESH_ACTION,
  } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const refreshPinnedWidgets = () => uiActions.invoke(PINNED_WIDGET_REFRESH_ACTION);
  const sectionDefinitions = [
    { scope: "workspace", title: "Workspace visible", description: "All sessions in this workspace" },
    { scope: "session", title: "Session only", description: "Only this session · default" },
  ];
  let touchDrag = null;
  let touchDraggingId = null;
  let touchDestination = null;
  let touchPreview = null;
  let suppressClickUntil = 0;
  const touchMoveFrame = createFrameScheduler(updateTouchPointer);
  $: activeGroup = $pinnedWidgetGroups.find((group) => group.id === $pinnedWidgetActiveGroup) ?? null;
  $: widgetView = buildPinnedWidgetViewModel($pinnedWidgets, $pinnedWidgetGroups, sectionDefinitions);
  $: activeGroupWidgets = activeGroup ? widgetView.groupWidgets.get(activeGroup.id) ?? [] : [];

  function dragStart(event, widget) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-oyster-widget", widget.id);
  }

  function dragStartGroup(event, group) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-oyster-widget-group", group.id);
  }

  function dropped(event, scope, groupId = null, beforeId = null) {
    event.preventDefault();
    event.stopPropagation();
    const draggedGroupId = event.dataTransfer.getData("application/x-oyster-widget-group");
    if (draggedGroupId) {
      uiActions.invoke(PINNED_WIDGET_MOVE_GROUP_ACTION, { id: draggedGroupId, scope });
      return;
    }
    const id = event.dataTransfer.getData("application/x-oyster-widget");
    if (id) uiActions.invoke(PINNED_WIDGET_MOVE_ACTION, { id, scope, groupId, beforeId });
  }

  function clearTouchDrag() {
    touchMoveFrame.cancel();
    if (touchDrag?.timer) clearTimeout(touchDrag.timer);
    touchDrag = null;
    touchDraggingId = null;
    touchDestination = null;
    touchPreview = null;
  }

  function touchPointerDown(event, item, type = "widget") {
    if ((type === "widget" && item.kind === "builtin") || event.pointerType === "mouse" || !event.isPrimary || !event.target.closest(".pinned-widget-icon")) return;
    clearTouchDrag();
    const drag = { pointerId: event.pointerId, item, type, cell: event.currentTarget, active: false, timer: null };
    drag.timer = setTimeout(() => {
      if (touchDrag !== drag) return;
      drag.active = true;
      drag.cell.setPointerCapture?.(drag.pointerId);
      touchDraggingId = item.id;
      touchPreview = { x: event.clientX, y: event.clientY, label: item.label ?? item.name };
    }, 300);
    touchDrag = drag;
  }

  function updateTouchPointer(pointerId, documentTarget, x, y) {
    if (!touchDrag || touchDrag.pointerId !== pointerId || !touchDrag.active) return;
    const target = documentTarget.elementFromPoint(x, y);
    const groupCell = target?.closest(".pinned-widget-group-cell");
    const section = target?.closest(".pinned-widget-section");
    touchDestination = groupCell
      ? { scope: groupCell.dataset.scope, groupId: groupCell.dataset.groupId }
      : section
        ? { scope: section.dataset.scope, groupId: null }
        : null;
    touchPreview = { x, y, label: touchDrag.item.label ?? touchDrag.item.name };
  }

  function touchPointerMove(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId || !touchDrag.active) return;
    event.preventDefault();
    touchMoveFrame.schedule(event.pointerId, event.currentTarget.ownerDocument, event.clientX, event.clientY);
  }

  function touchPointerUp(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const drag = touchDrag;
    if (!drag.active) { clearTouchDrag(); return; }
    event.preventDefault();
    touchMoveFrame.flush();
    suppressClickUntil = Date.now() + 500;
    const destination = touchDestination;
    clearTouchDrag();
    if (destination) {
      if (drag.type === "group") uiActions.invoke(PINNED_WIDGET_MOVE_GROUP_ACTION, { id: drag.item.id, scope: destination.scope });
      else uiActions.invoke(PINNED_WIDGET_MOVE_ACTION, { id: drag.item.id, ...destination, beforeId: null });
    }
  }

  function touchPointerCancel(event) {
    if (touchDrag?.pointerId === event.pointerId) clearTouchDrag();
  }

  function openWidget(event, widget) {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    uiActions.invoke(PINNED_WIDGET_OPEN_ACTION, widget);
  }

  onDestroy(clearTouchDrag);

  function widgetTitle(widget) {
    const availability = widget.availability === "ready" ? "" : ` · ${widget.availability}`;
    return `${widget.label}${availability}`;
  }

  function readyMedia(widget, kind) {
    return widget.kind === kind && widget.availability === "ready";
  }

  function isFolderWidget(widget) {
    return widget.kind === "directory" || widget.builtin === "file-explorer";
  }

  function widgetDropGroupId() {
    return activeGroup?.id ?? null;
  }

  function isSectionTouchTarget(section) {
    return touchDestination?.scope === section.scope && !touchDestination?.groupId;
  }

  function scopeTitle(scope) {
    return scope === "workspace" ? "Workspace visible" : "Session only";
  }

  function glyph(widget) {
    if (widget.kind === "markdown") return "M↓";
    if (String(widget.mimeType ?? "").startsWith("text/html")) return "HTML";
    if (widget.kind === "file") return "▤";
    if (widget.kind === "directory") return "▰";
    if (widget.kind === "link") return "↗";
    if (widget.kind === "live_interface") return "◉";
    return "•";
  }
</script>

{#snippet WidgetCell(widget, destinationScope)}
  <div
    role="listitem"
    class:pinned-widget-cell={true}
    class:unavailable={widget.availability !== "ready"}
    class:touch-dragging={touchDraggingId === widget.id}
    draggable={widget.kind !== "builtin"}
    ondragstart={(event) => dragStart(event, widget)}
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => dropped(event, destinationScope, widgetDropGroupId(), widget.id)}
    onpointerdown={(event) => touchPointerDown(event, widget)}
    onpointermove={touchPointerMove}
    onpointerup={touchPointerUp}
    onpointercancel={touchPointerCancel}
  >
    <button type="button" class="pinned-widget-tile" onclick={(event) => openWidget(event, widget)} title={widgetTitle(widget)}>
      <span class={`pinned-widget-icon kind-${widget.kind}`} aria-hidden="true">
        {#if readyMedia(widget, "image")}
          <img src={browserActions.pinnedWidgetMediaSource(widget.id)} alt="" loading="lazy" />
        {:else if readyMedia(widget, "video")}
          <video
            src={browserActions.pinnedWidgetMediaSource(widget.id)}
            muted
            preload="metadata"
            playsinline
            onloadedmetadata={(event) => { if (event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }}
          ></video><span class="pinned-widget-play">▶</span>
        {:else if isFolderWidget(widget)}
          <FolderIcon size={30} />
        {:else}
          <span class="pinned-widget-glyph">{glyph(widget)}</span>
        {/if}
        {#if widget.kind === "live_interface"}<span class={`pinned-widget-status status-${widget.availability}`}></span>{/if}
      </span>
      <span class="pinned-widget-label">{widget.label}</span>
    </button>
    {#if widget.kind !== "builtin"}
      <button type="button" class="pinned-widget-menu" aria-label={`Manage ${widget.label}`} onclick={() => uiActions.invoke(PINNED_WIDGET_MANAGE_ACTION, widget)}>•••</button>
    {/if}
  </div>
{/snippet}

{#snippet WidgetSection(section)}
  <section
    class="pinned-widget-section"
    class:touch-drop-target={isSectionTouchTarget(section)}
    data-scope={section.scope}
    aria-label={`${section.title} widgets`}
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => dropped(event, section.scope)}
  >
    <div class="pinned-widget-section-head">
      <strong>{section.title}</strong>
      <span>{section.description}</span>
    </div>
    <div class="pinned-widget-grid" role="list">
      {#each section.builtinWidgets as widget (widget.id)}
        {@render WidgetCell(widget, section.scope)}
      {/each}
      {#each section.groups as group (group.id)}
        <div
          role="listitem"
          class="pinned-widget-cell pinned-widget-group-cell"
          class:touch-drop-target={touchDestination?.groupId === group.id}
          class:touch-dragging={touchDraggingId === group.id}
          data-group-id={group.id}
          data-scope={group.scope}
          draggable="true"
          ondragstart={(event) => dragStartGroup(event, group)}
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => dropped(event, group.scope, group.id)}
          onpointerdown={(event) => touchPointerDown(event, group, "group")}
          onpointermove={touchPointerMove}
          onpointerup={touchPointerUp}
          onpointercancel={touchPointerCancel}
        >
          <button type="button" class="pinned-widget-tile" onclick={() => pinnedWidgetActiveGroup.set(group.id)} title={`Open ${group.name}`}>
            <span class="pinned-widget-icon pinned-widget-group-icon">
              {#each group.children.slice(0, 4) as child (child.id)}<span>{glyph(child)}</span>{/each}
            </span>
            <span class="pinned-widget-label">{group.name}</span>
            <span class="pinned-widget-count">{group.children.length}</span>
          </button>
          <button type="button" class="pinned-widget-menu" aria-label={`Manage ${group.name}`} onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, group)}>•••</button>
        </div>
      {/each}
      {#each section.movableWidgets as widget (widget.id)}
        {@render WidgetCell(widget, section.scope)}
      {/each}
    </div>
    {#if section.empty}
      <div class="pinned-widget-empty">Drag a widget here to change its visibility.</div>
    {/if}
  </section>
{/snippet}

{#if $pinnedWidgetsLoading}
  <div class="sidebar-loading" role="status"><span class="spin"></span> loading widgets…</div>
{:else if $pinnedWidgetsError}
  <div class="pinned-widget-empty async-error" role="alert">Could not load pinned widgets: {$pinnedWidgetsError} <button type="button" class="chip" onclick={refreshPinnedWidgets}>Retry</button></div>
{:else if activeGroup}
  <div class="pinned-widget-folder-head">
    <button type="button" class="pinned-widget-back" onclick={() => pinnedWidgetActiveGroup.set(null)} aria-label="Back to pinned widgets">←</button>
    <button type="button" class="pinned-widget-folder-title" onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, activeGroup)} title="Rename group">{activeGroup.name}</button>
  </div>
  <section class="pinned-widget-section" data-scope={activeGroup.scope}>
    <div class="pinned-widget-section-head"><strong>{scopeTitle(activeGroup.scope)}</strong></div>
    <div
      class="pinned-widget-grid"
      role="list"
      aria-label={`${activeGroup.name} widgets`}
      ondragover={(event) => event.preventDefault()}
      ondrop={(event) => dropped(event, activeGroup.scope, activeGroup.id)}
    >
      {#each activeGroupWidgets as widget (widget.id)}
        {@render WidgetCell(widget, activeGroup.scope)}
      {/each}
    </div>
    {#if !activeGroupWidgets.length}<div class="pinned-widget-empty">This group is empty. Drag widgets here or use their manage menu.</div>{/if}
  </section>
{:else}
  {#each widgetView.sections as section (section.scope)}
    {@render WidgetSection(section)}
  {/each}
{/if}

{#if touchPreview}
  <div class="pinned-widget-touch-preview" style={`left:${touchPreview.x}px;top:${touchPreview.y}px;`}>{touchPreview.label}</div>
{/if}
