<script>
  import { onDestroy } from "svelte";
  import AppIcon from "./AppIcon.svelte";
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
  const SECTION_DEFINITIONS = [
    { scope: "workspace", title: "Workspace visible", description: "All sessions in this workspace" },
    { scope: "session", title: "Session only", description: "Only this session · default" },
  ];
  const TOUCH_DRAG_DELAY_MS = 300;
  const TOUCH_DRAG_MOVE_TOLERANCE_PX = 8;
  const CLICK_SUPPRESSION_MS = 500;
  const MONITOR_REFRESH_INTERVAL_MS = 3_000;

  let touchDrag = $state(null);
  let touchDraggingId = $state(null);
  let touchDestination = $state(null);
  let touchPreview = $state(null);
  let suppressClickUntil = 0;
  let monitorPreviews = $state({});
  const touchMoveFrame = createFrameScheduler(updateTouchPointer);
  const activeGroup = $derived($pinnedWidgetGroups.find((group) => group.id === $pinnedWidgetActiveGroup) ?? null);
  const widgetView = $derived(buildPinnedWidgetViewModel($pinnedWidgets, $pinnedWidgetGroups, SECTION_DEFINITIONS));
  const activeGroupWidgets = $derived(activeGroup ? widgetView.groupWidgets.get(activeGroup.id) ?? [] : []);

  function refreshPinnedWidgets() {
    uiActions.invoke(PINNED_WIDGET_REFRESH_ACTION);
  }

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
    const drag = touchDrag;
    touchMoveFrame.cancel();
    if (drag?.timer) clearTimeout(drag.timer);
    if (drag?.cell.hasPointerCapture?.(drag.pointerId)) drag.cell.releasePointerCapture?.(drag.pointerId);
    touchDrag = null;
    touchDraggingId = null;
    touchDestination = null;
    touchPreview = null;
  }

  function touchPointerDown(event, item, type = "widget") {
    const startsOnIcon = event.target?.closest?.(".pinned-widget-icon");
    if ((type === "widget" && item.kind === "builtin") || event.pointerType === "mouse" || !event.isPrimary || !startsOnIcon) return;

    clearTouchDrag();
    const drag = {
      pointerId: event.pointerId,
      item,
      type,
      cell: event.currentTarget,
      active: false,
      timer: null,
      startX: event.clientX,
      startY: event.clientY,
      token: Symbol("touch-drag"),
    };
    drag.cell.setPointerCapture?.(drag.pointerId);
    drag.timer = setTimeout(() => {
      if (touchDrag?.token !== drag.token) return;
      touchDrag.active = true;
      touchDraggingId = item.id;
      touchPreview = { x: drag.startX, y: drag.startY, label: item.label ?? item.name };
    }, TOUCH_DRAG_DELAY_MS);
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
        ? { scope: section.dataset.scope, groupId: section.dataset.groupId || null }
        : null;
    touchPreview = { x, y, label: touchDrag.item.label ?? touchDrag.item.name };
  }

  function touchPointerMove(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    if (!touchDrag.active) {
      const movedX = Math.abs(event.clientX - touchDrag.startX);
      const movedY = Math.abs(event.clientY - touchDrag.startY);
      if (Math.max(movedX, movedY) > TOUCH_DRAG_MOVE_TOLERANCE_PX) clearTouchDrag();
      return;
    }
    event.preventDefault();
    touchMoveFrame.schedule(event.pointerId, event.currentTarget.ownerDocument, event.clientX, event.clientY);
  }

  function touchPointerUp(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const drag = touchDrag;
    if (!drag.active) {
      clearTouchDrag();
      return;
    }
    event.preventDefault();
    touchMoveFrame.flush();
    suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
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

  function monitorPreview(node, initialWidget) {
    let widget = initialWidget;
    let fetching = false;
    let generation = 0;
    let timer = null;

    function visible() {
      if (node.ownerDocument.visibilityState === "hidden" || !node.getClientRects().length) return false;
      const bounds = node.getBoundingClientRect();
      const viewport = node.ownerDocument.documentElement;
      return bounds.bottom > 0 && bounds.right > 0 && bounds.top < viewport.clientHeight && bounds.left < viewport.clientWidth;
    }

    async function refresh() {
      if (fetching || widget.kind !== "monitoring" || !visible()) return;
      fetching = true;
      const requestGeneration = generation;
      const widgetId = widget.id;
      try {
        const data = await browserActions.readPinnedWidgetMonitorPreview(widgetId);
        if (requestGeneration === generation) {
          monitorPreviews = { ...monitorPreviews, [widgetId]: { value: data.preview || "—", error: false } };
        }
      } catch {
        if (requestGeneration === generation) {
          monitorPreviews = { ...monitorPreviews, [widgetId]: { value: "unavailable", error: true } };
        }
      } finally {
        fetching = false;
      }
    }

    function stop() {
      generation += 1;
      if (timer !== null) clearInterval(timer);
      timer = null;
    }

    function start() {
      if (widget.kind !== "monitoring" || timer !== null) return;
      refresh();
      timer = setInterval(refresh, MONITOR_REFRESH_INTERVAL_MS);
    }

    start();
    return {
      update(nextWidget) {
        if (nextWidget.id !== widget.id || nextWidget.kind !== widget.kind) stop();
        widget = nextWidget;
        start();
      },
      destroy() {
        stop();
      },
    };
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
    return SECTION_DEFINITIONS.find((section) => section.scope === scope)?.title ?? scope;
  }

  function groupButtonLabel(group) {
    const noun = group.children.length === 1 ? "widget" : "widgets";
    return `Open ${group.name}, ${group.children.length} ${noun}`;
  }

  function showVideoThumbnail(event) {
    const video = event.currentTarget;
    if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
  }

  function glyph(widget) {
    if (widget.kind === "markdown") return "M↓";
    if (String(widget.mimeType ?? "").startsWith("text/html")) return "HTML";
    if (widget.kind === "file") return "▤";
    if (widget.kind === "directory") return "▰";
    if (widget.kind === "link") return "↗";
    if (widget.kind === "live_interface") return "◉";
    if (widget.kind === "monitoring") return "···";
    return "•";
  }
</script>

{#snippet WidgetCell(widget, destinationScope)}
  <div
    role="listitem"
    class="pinned-widget-cell"
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
    <button
      type="button"
      class="pinned-widget-tile"
      onclick={(event) => openWidget(event, widget)}
      aria-label={widgetTitle(widget)}
      title={widgetTitle(widget)}
    >
      <span class={`pinned-widget-icon kind-${widget.kind}`} aria-hidden="true" use:monitorPreview={widget}>
        {#if readyMedia(widget, "image")}
          <img src={browserActions.pinnedWidgetMediaSource(widget.id)} alt="" loading="lazy" />
        {:else if readyMedia(widget, "video")}
          <video
            src={browserActions.pinnedWidgetMediaSource(widget.id)}
            muted
            preload="metadata"
            playsinline
            onloadedmetadata={showVideoThumbnail}
          ></video><span class="pinned-widget-play">▶</span>
        {:else if isFolderWidget(widget)}
          <FolderIcon size={30} />
        {:else if widget.kind === "monitoring" && monitorPreviews[widget.id]}
          <span class:monitor-preview-error={monitorPreviews[widget.id].error} class="pinned-widget-monitor-preview">{monitorPreviews[widget.id].value}</span>
        {:else}
          <span class="pinned-widget-glyph">{glyph(widget)}</span>
        {/if}
        {#if widget.kind === "live_interface"}<span class={`pinned-widget-status status-${widget.availability}`}></span>{/if}
      </span>
      <span class="pinned-widget-label">{widget.label}</span>
    </button>
    {#if widget.kind !== "builtin"}
      <button
        type="button"
        class="pinned-widget-menu"
        aria-label={`Manage ${widget.label}`}
        title={`Manage ${widget.label}`}
        onclick={() => uiActions.invoke(PINNED_WIDGET_MANAGE_ACTION, widget)}
      ><AppIcon name="more" size={15} /></button>
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
          draggable={true}
          ondragstart={(event) => dragStartGroup(event, group)}
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => dropped(event, group.scope, group.id)}
          onpointerdown={(event) => touchPointerDown(event, group, "group")}
          onpointermove={touchPointerMove}
          onpointerup={touchPointerUp}
          onpointercancel={touchPointerCancel}
        >
          <button
            type="button"
            class="pinned-widget-tile"
            onclick={() => pinnedWidgetActiveGroup.set(group.id)}
            aria-label={groupButtonLabel(group)}
            title={`Open ${group.name}`}
          >
            <span class="pinned-widget-icon pinned-widget-group-icon" aria-hidden="true">
              {#each group.children.slice(0, 4) as child (child.id)}<span>{glyph(child)}</span>{/each}
            </span>
            <span class="pinned-widget-label">{group.name}</span>
            <span class="pinned-widget-count">{group.children.length}</span>
          </button>
          <button
            type="button"
            class="pinned-widget-menu"
            aria-label={`Manage ${group.name}`}
            title={`Manage ${group.name}`}
            onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, group)}
          ><AppIcon name="more" size={15} /></button>
        </div>
      {/each}
      {#each section.movableWidgets as widget (widget.id)}
        {@render WidgetCell(widget, section.scope)}
      {/each}
    </div>
    {#if section.empty}
      <div class="pinned-widget-empty" role="status">Drag a widget here to change its visibility.</div>
    {/if}
  </section>
{/snippet}

<div class="pinned-widget-collection" aria-busy={$pinnedWidgetsLoading}>
{#if $pinnedWidgetsLoading}
  <div class="sidebar-loading" role="status" aria-atomic="true"><span class="spin" aria-hidden="true"></span> Loading widgets…</div>
{:else if $pinnedWidgetsError}
  <div class="pinned-widget-empty async-error" role="alert" aria-atomic="true">Could not load pinned widgets: {$pinnedWidgetsError} <button type="button" class="chip" onclick={refreshPinnedWidgets}>Retry</button></div>
{:else if activeGroup}
  <div class="pinned-widget-folder-head">
    <button type="button" class="pinned-widget-back" onclick={() => pinnedWidgetActiveGroup.set(null)} aria-label="Back to pinned widgets">←</button>
    <button type="button" class="pinned-widget-folder-title" onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, activeGroup)} title="Rename group">{activeGroup.name}</button>
  </div>
  <section class="pinned-widget-section" data-scope={activeGroup.scope} data-group-id={activeGroup.id}>
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
    {#if !activeGroupWidgets.length}<div class="pinned-widget-empty" role="status">This group is empty. Drag widgets here or use their manage menu.</div>{/if}
  </section>
{:else}
  {#each widgetView.sections as section (section.scope)}
    {@render WidgetSection(section)}
  {/each}
{/if}
</div>

{#if touchPreview}
  <div
    class="pinned-widget-touch-preview"
    style:left={`${touchPreview.x}px`}
    style:top={`${touchPreview.y}px`}
    aria-hidden="true"
  >{touchPreview.label}</div>
{/if}

<style>
  .pinned-widget-collection {
    display: grid;
    min-width: 0;
  }

  .pinned-widget-section {
    min-width: 0;
    min-height: 48px;
    margin-bottom: 12px;
    padding: 9px 7px 10px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: color-mix(in srgb, var(--panel-2) 28%, transparent);
    transition: border-color .14s, background .14s, box-shadow .14s;
  }

  .pinned-widget-section.touch-drop-target {
    border-color: color-mix(in srgb, var(--green) 70%, var(--border));
    background: color-mix(in srgb, var(--green) 9%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--green) 26%, transparent);
  }

  .pinned-widget-section-head {
    display: flex;
    min-width: 0;
    margin: 0 2px 9px;
    flex-direction: column;
    gap: 2px;
  }

  .pinned-widget-section-head strong {
    overflow: hidden;
    color: var(--text);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .1em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .pinned-widget-section-head span {
    color: var(--muted);
    font-size: 9px;
    line-height: 1.3;
  }

  .pinned-widget-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: 12px 7px;
  }

  .pinned-widget-cell {
    position: relative;
    min-width: 0;
    border-radius: 11px;
  }

  .pinned-widget-cell[draggable="true"] { cursor: grab; }
  .pinned-widget-cell[draggable="true"]:active { cursor: grabbing; }

  .pinned-widget-cell[draggable="true"] .pinned-widget-icon {
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
  }

  .pinned-widget-cell.touch-dragging { opacity: .42; }

  .pinned-widget-group-cell.touch-drop-target {
    background: color-mix(in srgb, var(--green) 12%, transparent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--green) 70%, var(--border));
  }

  .pinned-widget-touch-preview {
    position: fixed;
    z-index: 1200;
    max-width: min(180px, calc(100vw - 24px));
    padding: 7px 10px;
    border: 1px solid color-mix(in srgb, var(--green) 58%, var(--border));
    border-radius: 9px;
    transform: translate(-50%, -125%);
    overflow: hidden;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 10px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .pinned-widget-tile {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 78px;
    padding: 3px 2px;
    border: 1px solid transparent;
    border-radius: 10px;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: border-color .14s, background .14s, transform .14s;
  }

  .pinned-widget-tile:hover {
    border-color: color-mix(in srgb, var(--accent) 18%, transparent);
    background: var(--surface-hover);
    transform: translateY(-1px);
  }

  .pinned-widget-icon {
    position: relative;
    display: grid;
    width: 50px;
    height: 50px;
    overflow: hidden;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--panel-2);
    box-shadow: 0 5px 14px color-mix(in srgb, var(--bg) 55%, transparent);
    color: color-mix(in srgb, var(--accent) 72%, var(--text));
  }

  .pinned-widget-icon img,
  .pinned-widget-icon video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .pinned-widget-icon.kind-image,
  .pinned-widget-icon.kind-video { background: color-mix(in srgb, var(--bg) 88%, var(--panel)); }
  .pinned-widget-icon.kind-markdown { background: color-mix(in srgb, var(--accent-dim) 72%, var(--panel-2)); color: color-mix(in srgb, var(--accent) 70%, var(--text)); }
  .pinned-widget-icon.kind-live_interface { background: color-mix(in srgb, var(--green) 12%, var(--panel-2)); color: var(--green); }
  .pinned-widget-icon.kind-link { background: color-mix(in srgb, var(--accent) 9%, var(--panel-2)); color: var(--accent); }
  .pinned-widget-icon.kind-file { background: color-mix(in srgb, var(--muted) 9%, var(--panel-2)); color: color-mix(in srgb, var(--muted) 72%, var(--text)); }
  .pinned-widget-icon.kind-monitoring { background: color-mix(in srgb, var(--green) 9%, var(--panel-2)); color: var(--green); }

  .pinned-widget-monitor-preview {
    display: -webkit-box;
    width: 100%;
    max-width: 100%;
    max-height: 100%;
    padding: 5px;
    overflow: hidden;
    font: 700 9px/1.18 var(--mono);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  }

  .pinned-widget-monitor-preview.monitor-preview-error { color: var(--red); font-size: 7.5px; }
  .pinned-widget-glyph { font-size: 18px; font-weight: 700; letter-spacing: -.04em; }

  .pinned-widget-label {
    display: -webkit-box;
    width: 100%;
    overflow: hidden;
    color: var(--muted);
    font-size: 9.5px;
    font-weight: 580;
    line-height: 1.2;
    text-align: center;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .pinned-widget-menu {
    position: absolute;
    z-index: 2;
    top: -3px;
    right: -2px;
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    opacity: 0;
    background: var(--panel);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--bg) 48%, transparent);
    color: var(--muted);
    cursor: pointer;
    transition: opacity .14s, color .14s, background .14s;
  }

  .pinned-widget-cell:hover .pinned-widget-menu,
  .pinned-widget-menu:focus-visible { opacity: 1; }
  .pinned-widget-menu:hover { background: var(--surface-hover); color: var(--text); }
  .pinned-widget-cell.unavailable .pinned-widget-icon { opacity: .48; filter: grayscale(.65); }
  .pinned-widget-cell.unavailable .pinned-widget-label { text-decoration: line-through; }

  .pinned-widget-status {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--panel-2);
    border-radius: 50%;
    background: var(--muted);
  }

  .pinned-widget-status.status-ready { background: var(--green); }
  .pinned-widget-status.status-opening { background: var(--yellow); animation: widget-status-pulse 1.4s ease-in-out infinite; }
  .pinned-widget-status.status-error,
  .pinned-widget-status.status-closed { background: var(--red); }

  @keyframes widget-status-pulse {
    50% { opacity: .55; transform: scale(.8); }
  }

  .pinned-widget-play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 15px;
    filter: drop-shadow(0 1px 4px #000);
    pointer-events: none;
  }

  .pinned-widget-group-icon {
    padding: 5px;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 3px;
    background: color-mix(in srgb, var(--accent) 7%, var(--panel-2));
  }

  .pinned-widget-group-icon > span {
    display: grid;
    width: 17px;
    height: 17px;
    place-items: center;
    border-radius: 5px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: color-mix(in srgb, var(--accent) 75%, var(--text));
    font-size: 7px;
    font-weight: 700;
  }

  .pinned-widget-count {
    position: absolute;
    top: 40px;
    right: 6px;
    min-width: 16px;
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
    border-radius: 999px;
    background: var(--accent-dim);
    color: var(--accent);
    font-size: 8px;
    font-weight: 750;
  }

  .pinned-widget-folder-head {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
    margin: -2px 0 6px;
  }

  .pinned-widget-back,
  .pinned-widget-folder-title {
    min-height: 32px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .pinned-widget-back { width: 32px; flex: none; padding: 0; font-size: 18px; }
  .pinned-widget-folder-title { min-width: 0; overflow: hidden; padding: 5px 7px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .pinned-widget-back:hover,
  .pinned-widget-folder-title:hover { border-color: color-mix(in srgb, var(--accent) 18%, transparent); background: var(--surface-hover); }

  .pinned-widget-empty {
    padding: 12px 6px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.45;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .pinned-widget-empty.async-error { color: var(--red); }
  .pinned-widget-empty .chip { margin-left: 5px; }

  @media (hover: none) {
    .pinned-widget-menu { opacity: .72; }
  }

  @media (max-width: 760px) {
    .pinned-widget-section { padding: 10px 8px 12px; }
    .pinned-widget-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 15px 8px; }
    .pinned-widget-icon { width: 52px; height: 52px; }
    .pinned-widget-label { font-size: 10px; }
    .pinned-widget-menu { width: var(--icon-control-standard); height: var(--icon-control-standard); top: -5px; right: -4px; }
    .pinned-widget-back { width: var(--icon-control-standard); min-height: var(--icon-control-standard); }
    .pinned-widget-folder-title { min-height: 40px; }
    .pinned-widget-empty .chip { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .pinned-widget-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
</style>
