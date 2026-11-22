import { readThreadSelection } from "../features/threads/threadModel.js";

const REPLY_SELECTOR = '.assistant-entry[data-role="assistant"]';
const REPLY_TEXT_SELECTOR = '[data-assistant-part="text"]';
const GAP_PX = 8;
const EDGE_PX = 8;

/** The reply whose rendered text contains `node`; tool cards and thinking are not quotable. */
function replyOf(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element?.closest(REPLY_TEXT_SELECTOR)) return null;
  return element.closest(REPLY_SELECTOR);
}

/**
 * Read the current text selection as a thread anchor inside the transcript
 * `scroller`, and place a `toolbar` of the given size next to it within the
 * scroller's parent. Coordinates are relative to that parent.
 *
 * The toolbar goes below the selection, clear of the operating system's own
 * selection menu, and falls back above it when there is no room underneath.
 * Returns null when nothing quotable is selected or it has scrolled away.
 */
export function measureReplySelection(scroller, toolbar = null) {
  const shell = scroller?.parentElement;
  if (!shell) return null;
  const found = readThreadSelection(scroller.ownerDocument.getSelection(), replyOf);
  // A re-rendered transcript replaces its nodes: a selection inside removed ones is gone.
  if (!found || !found.entry.isConnected || !scroller.contains(found.entry)) return null;
  const frame = shell.getBoundingClientRect();
  if (found.rect.bottom < frame.top || found.rect.top > frame.bottom) return null;
  const replies = scroller.querySelectorAll(REPLY_SELECTOR);
  const width = toolbar?.offsetWidth ?? 0;
  const height = toolbar?.offsetHeight ?? 0;
  const centred = found.rect.left + found.rect.width / 2 - frame.left - width / 2;
  const below = found.rect.bottom - frame.top + GAP_PX;
  return {
    entry: found.entry,
    quote: found.quote,
    // The newest reply may still be streaming; callers decide whether that blocks a thread.
    last: replies[replies.length - 1] === found.entry,
    left: Math.max(EDGE_PX, Math.min(centred, frame.width - width - EDGE_PX)),
    top: below + height + EDGE_PX <= frame.height ? below : Math.max(EDGE_PX, found.rect.top - frame.top - height - GAP_PX),
  };
}

export function clearTextSelection(scroller) {
  scroller?.ownerDocument.getSelection()?.removeAllRanges();
}
