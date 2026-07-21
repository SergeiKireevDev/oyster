/** Calculate the viewport-safe command palette position for a target input. */
export function commandPalettePosition(rect, viewport, { gap = 8, maxWidth = 420, minWidth = 280, maxHeight = 320 } = {}) {
  const width = Math.min(maxWidth, Math.max(minWidth, rect.width));
  let left = rect.left;
  if (left + width > viewport.innerWidth - gap) left = viewport.innerWidth - width - gap;
  if (rect.top > maxHeight + gap) {
    const top = rect.top - gap;
    return {
      left: `${left}px`, width: `${width}px`, bottom: `${viewport.innerHeight - top}px`, top: "auto",
      maxHeight: `${Math.min(maxHeight, viewport.innerHeight - top - gap * 2)}px`,
    };
  }
  const top = rect.bottom + gap;
  return {
    left: `${left}px`, width: `${width}px`, top: `${top}px`, bottom: "auto",
    maxHeight: `${Math.min(maxHeight, viewport.innerHeight - rect.bottom - gap * 2)}px`,
  };
}
