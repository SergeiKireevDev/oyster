/**
 * Whether typing happens on an on-screen keyboard. Such keyboards have no
 * Shift+Enter, so there Enter must break the line and the Send button sends.
 * A coarse primary pointer (finger) is the signal; a mouse or trackpad means a
 * physical keyboard, where Enter sends and Shift+Enter breaks the line.
 */
export function usesTouchKeyboard(windowTarget = globalThis) {
  return Boolean(windowTarget.matchMedia?.("(pointer: coarse)").matches);
}
