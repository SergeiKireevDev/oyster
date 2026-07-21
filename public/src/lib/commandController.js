/** Calculate the viewport-safe command palette position for a target input. */
export function commandPalettePosition(rect, viewport, { gap = 8, maxWidth = 420, minWidth = 280, maxHeight = 320 } = {}) {
  const width = Math.min(maxWidth, Math.max(minWidth, rect.width));
  let left = rect.left;
  if (left + width > viewport.innerWidth - gap) left = viewport.innerWidth - width - gap;
  if (rect.top > maxHeight + gap) {
    const top = rect.top - gap;
    return { left: `${left}px`, width: `${width}px`, bottom: `${viewport.innerHeight - top}px`, top: "auto", maxHeight: `${Math.min(maxHeight, viewport.innerHeight - top - gap * 2)}px` };
  }
  const top = rect.bottom + gap;
  return { left: `${left}px`, width: `${width}px`, top: `${top}px`, bottom: "auto", maxHeight: `${Math.min(maxHeight, viewport.innerHeight - rect.bottom - gap * 2)}px` };
}

/** Create Svelte palette state from the active command match. */
export function commandPaletteView(items, match, active) {
  if (!items.length) return { open: true, match, emptyText: `no command matches ":${match}"`, items: [] };
  return { open: true, match, emptyText: "", items: items.map((command, index) => ({ icon: command.icon, desc: command.desc, highlight: command.name.slice(0, match.length), rest: command.name.slice(match.length), active: index === active })) };
}

/** Wrap a command palette selection index across the visible command list. */
export function moveCommandPaletteActive(active, count, direction) {
  if (!count) return active;
  return (active + direction + count) % count;
}

/** Own the palette's capture-phase keyboard lifecycle outside component markup. */
export function createCommandPaletteRunController({ windowTarget, run }) {
  const onRun = (event) => run(event.detail);
  function attach() {
    windowTarget.addEventListener("pi-command-palette-run", onRun);
    return detach;
  }
  function detach() {
    windowTarget.removeEventListener("pi-command-palette-run", onRun);
  }
  return { attach, detach };
}

export function createCommandPaletteKeyboardController({ documentTarget, isOpen, move, run, close }) {
  const onKeydown = (event) => {
    if (!isOpen()) return;
    const actions = {
      ArrowDown: () => move(1), ArrowUp: () => move(-1),
      Enter: run, Tab: run, Escape: close,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  function attach() {
    documentTarget.addEventListener("keydown", onKeydown, true);
    return detach;
  }

  function detach() {
    documentTarget.removeEventListener("keydown", onKeydown, true);
  }

  return { attach, detach };
}
