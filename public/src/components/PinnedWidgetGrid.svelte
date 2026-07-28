<script>
  import { onDestroy } from "svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import { pinnedWidgetMediaUrl } from "../lib/pinnedWidgetActions.js";
  import {
    pinnedWidgetActiveGroup,
    pinnedWidgetGroups,
    pinnedWidgets,
    pinnedWidgetsLoading,
  } from "../stores/pinnedWidgets.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    PINNED_WIDGET_MANAGE_ACTION,
    PINNED_WIDGET_MOVE_ACTION,
    PINNED_WIDGET_OPEN_ACTION,
    PINNED_WIDGET_RENAME_GROUP_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let touchDrag = null;
  let touchDraggingId = null;
  let touchDropGroupId = null;
  let touchPreview = null;
  let suppressClickUntil = 0;
  $: activeGroup = $pinnedWidgetGroups.find((group) => group.id === $pinnedWidgetActiveGroup) ?? null;
  $: visibleWidgets = $pinnedWidgets
    .filter((widget) => (widget.groupId ?? null) === (activeGroup?.id ?? null))
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  $: builtinWidgets = visibleWidgets.filter((widget) => widget.kind === "builtin");
  $: movableWidgets = visibleWidgets.filter((widget) => widget.kind !== "builtin");
  $: visibleGroups = activeGroup ? [] : [...$pinnedWidgetGroups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  function dragStart(event, widget) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-oyster-widget", widget.id);
  }

  function dropped(event, groupId, beforeId = null) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("application/x-oyster-widget");
    if (id) uiActions.invoke(PINNED_WIDGET_MOVE_ACTION, { id, groupId, beforeId });
  }

  function clearTouchDrag() {
    if (touchDrag?.timer) clearTimeout(touchDrag.timer);
    touchDrag = null;
    touchDraggingId = null;
    touchDropGroupId = null;
    touchPreview = null;
  }

  function touchPointerDown(event, widget) {
    if (widget.kind === "builtin" || event.pointerType === "mouse" || !event.isPrimary || !event.target.closest(".pinned-widget-icon")) return;
    clearTouchDrag();
    const drag = {
      pointerId: event.pointerId,
      widget,
      cell: event.currentTarget,
      active: false,
      timer: null,
    };
    drag.timer = setTimeout(() => {
      if (touchDrag !== drag) return;
      drag.active = true;
      drag.cell.setPointerCapture?.(drag.pointerId);
      touchDraggingId = widget.id;
      touchPreview = { x: event.clientX, y: event.clientY, label: widget.label };
    }, 300);
    touchDrag = drag;
  }

  function touchPointerMove(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId || !touchDrag.active) return;
    event.preventDefault();
    const groupCell = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest(".pinned-widget-group-cell");
    touchDropGroupId = groupCell?.dataset.groupId ?? null;
    touchPreview = { x: event.clientX, y: event.clientY, label: touchDrag.widget.label };
  }

  function touchPointerUp(event) {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const drag = touchDrag;
    if (!drag.active) {
      clearTouchDrag();
      return;
    }
    event.preventDefault();
    suppressClickUntil = Date.now() + 500;
    const groupId = touchDropGroupId;
    clearTouchDrag();
    if (groupId) uiActions.invoke(PINNED_WIDGET_MOVE_ACTION, { id: drag.widget.id, groupId, beforeId: null });
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

{#if $pinnedWidgetsLoading}
  <div class="sidebar-loading"><span class="spin"></span> loading widgets…</div>
{:else}
  {#if activeGroup}
    <div class="pinned-widget-folder-head">
      <button type="button" class="pinned-widget-back" onclick={() => pinnedWidgetActiveGroup.set(null)} aria-label="Back to pinned widgets">←</button>
      <button type="button" class="pinned-widget-folder-title" onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, activeGroup)} title="Rename group">{activeGroup.name}</button>
    </div>
  {/if}

  {#snippet WidgetCell(widget)}
    <div
      role="listitem"
      class:pinned-widget-cell={true}
      class:unavailable={widget.availability !== "ready"}
      class:touch-dragging={touchDraggingId === widget.id}
      draggable={widget.kind !== "builtin"}
      ondragstart={(event) => dragStart(event, widget)}
      ondragover={(event) => event.preventDefault()}
      ondrop={(event) => dropped(event, activeGroup?.id ?? null, widget.id)}
      onpointerdown={(event) => touchPointerDown(event, widget)}
      onpointermove={touchPointerMove}
      onpointerup={touchPointerUp}
      onpointercancel={touchPointerCancel}
    >
      <button type="button" class="pinned-widget-tile" onclick={(event) => openWidget(event, widget)} title={`${widget.label}${widget.availability !== "ready" ? ` · ${widget.availability}` : ""}`}>
        <span class={`pinned-widget-icon kind-${widget.kind}`}>
          {#if widget.kind === "image" && widget.availability === "ready"}
            <img src={pinnedWidgetMediaUrl(widget.id)} alt="" loading="lazy" />
          {:else if widget.kind === "video" && widget.availability === "ready"}
            <video
              src={pinnedWidgetMediaUrl(widget.id)}
              muted
              preload="metadata"
              playsinline
              onloadedmetadata={(event) => { if (event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }}
            ></video><span class="pinned-widget-play">▶</span>
          {:else if widget.kind === "directory" || widget.builtin === "file-explorer"}
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

  <div
    class="pinned-widget-grid"
    role="list"
    aria-label={activeGroup ? `${activeGroup.name} widgets` : "Pinned widgets"}
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => dropped(event, activeGroup?.id ?? null)}
  >
    {#each builtinWidgets as widget (widget.id)}
      {@render WidgetCell(widget)}
    {/each}

    {#each visibleGroups as group (group.id)}
      {@const children = $pinnedWidgets.filter((widget) => widget.groupId === group.id)}
      <div
        role="listitem"
        class="pinned-widget-cell pinned-widget-group-cell"
        class:touch-drop-target={touchDropGroupId === group.id}
        data-group-id={group.id}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => dropped(event, group.id)}
      >
        <button type="button" class="pinned-widget-tile" onclick={() => pinnedWidgetActiveGroup.set(group.id)} title={`Open ${group.name}`}>
          <span class="pinned-widget-icon pinned-widget-group-icon">
            {#each children.slice(0, 4) as child (child.id)}<span>{glyph(child)}</span>{/each}
          </span>
          <span class="pinned-widget-label">{group.name}</span>
          <span class="pinned-widget-count">{children.length}</span>
        </button>
        <button type="button" class="pinned-widget-menu" aria-label={`Manage ${group.name}`} onclick={() => uiActions.invoke(PINNED_WIDGET_RENAME_GROUP_ACTION, group)}>•••</button>
      </div>
    {/each}

    {#each movableWidgets as widget (widget.id)}
      {@render WidgetCell(widget)}
    {/each}
  </div>

  {#if touchPreview}
    <div class="pinned-widget-touch-preview" style={`left:${touchPreview.x}px;top:${touchPreview.y}px;`}>{touchPreview.label}</div>
  {/if}

  {#if !visibleWidgets.length && activeGroup}
    <div class="pinned-widget-empty">This group is empty. Drag widgets here or use their manage menu.</div>
  {/if}
{/if}
