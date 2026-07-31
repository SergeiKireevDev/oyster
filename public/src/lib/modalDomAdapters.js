const optionSelector = "button.m-option:not(:disabled), .session-row > button.s-session-main:not(:disabled), label.m-option";
const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function visibleFocusableElements(dialog) {
  return [...dialog.querySelectorAll(focusableSelector)].filter((element) => (
    !element.hidden
    && element.getAttribute?.("aria-hidden") !== "true"
    && element.getClientRects().length > 0
  ));
}

/**
 * Own focus for the lifetime of a modal: capture the opener, move focus into
 * the dialog, trap Tab navigation, and restore focus after dismissal.
 */
export function modalFocusManagement(dialog, parameters) {
  let isOpen = false;
  let identity = null;
  let opener = null;
  let focusGeneration = 0;

  function stateFrom(value) {
    return typeof value === "object" && value !== null
      ? { open: !!value.open, identity: value.identity ?? null }
      : { open: !!value, identity: null };
  }

  function focusInitial(generation) {
    queueMicrotask(() => {
      if (!isOpen || generation !== focusGeneration) return;
      const preferred = dialog.querySelector("[autofocus], [data-modal-initial-focus]");
      const target = preferred && !preferred.disabled && preferred.getClientRects().length > 0
        ? preferred
        : visibleFocusableElements(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    });
  }

  function update(value) {
    const next = stateFrom(value);
    const opening = next.open && !isOpen;
    const replacing = next.open && isOpen && next.identity !== identity;
    if (!opening && !replacing && next.open === isOpen) return;
    focusGeneration += 1;
    if (opening) opener = dialog.ownerDocument.activeElement;
    isOpen = next.open;
    identity = next.identity;
    if (isOpen) {
      focusInitial(focusGeneration);
      return;
    }
    if (opener?.isConnected !== false && typeof opener?.focus === "function") {
      opener.focus({ preventScroll: true });
    }
    opener = null;
  }

  function focusInside() {
    const target = visibleFocusableElements(dialog)[0] ?? dialog;
    target.focus({ preventScroll: true });
  }

  function keydown(event) {
    if (!isOpen || event.key !== "Tab") return;
    const focusable = visibleFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      focusInside();
      return;
    }
    const active = dialog.ownerDocument.activeElement;
    const current = focusable.indexOf(active);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusable[next].focus({ preventScroll: true });
  }

  function focusin(event) {
    if (isOpen && !dialog.contains(event.target)) focusInside();
  }

  dialog.addEventListener("keydown", keydown, true);
  dialog.ownerDocument.addEventListener("focusin", focusin, true);
  update(parameters);

  return {
    update,
    destroy() {
      focusGeneration += 1;
      const restoreTarget = isOpen ? opener : null;
      isOpen = false;
      dialog.removeEventListener("keydown", keydown, true);
      dialog.ownerDocument.removeEventListener("focusin", focusin, true);
      if (restoreTarget?.isConnected !== false && typeof restoreTarget?.focus === "function") {
        restoreTarget.focus({ preventScroll: true });
      }
      opener = null;
    },
  };
}

/**
 * DOM adapter for keyboard behavior shared by heterogeneous modal contents.
 * Keeping selector-based discovery in this action lets modal components remain
 * declarative while preserving navigation for content registered at runtime.
 */
export function modalKeyboardNavigation(overlay, parameters) {
  let options = parameters;
  let keyboardOption = null;

  function visibleOptions() {
    return [...overlay.querySelectorAll(optionSelector)].filter((option) => option.getClientRects().length > 0);
  }

  function activateOption(option) {
    if (option === keyboardOption) return;
    keyboardOption?.closest(".m-option")?.classList.remove("keyboard-active");
    keyboardOption = option;
    keyboardOption?.closest(".m-option")?.classList.add("keyboard-active");
    keyboardOption?.scrollIntoView({ block: "nearest" });
  }

  function keydown(event) {
    if (!options.isOpen()) return;
    if (options.content() === "optionPicker") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestModalCancel(overlay);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (event.target.matches?.("textarea, select, [contenteditable=true]")
      || (event.key === "Enter" && !keyboardOption && event.target.matches?.("input, button"))) return;
    const available = visibleOptions();
    if (!available.length) {
      const primary = event.key === "Enter" ? overlay.querySelector(".m-actions button.btn:not(:disabled)") : null;
      if (!primary) return;
      event.preventDefault();
      event.stopPropagation();
      primary.click();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") {
      const selected = available.includes(keyboardOption)
        ? keyboardOption
        : event.target.closest?.(optionSelector) ?? available[0];
      selected?.click();
      return;
    }
    const current = available.indexOf(keyboardOption);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = current < 0
      ? (direction > 0 ? 0 : available.length - 1)
      : (current + direction + available.length) % available.length;
    activateOption(available[next]);
  }

  function pointermove(event) {
    const option = event.target.closest?.(optionSelector);
    if (option && overlay.contains(option)) activateOption(option);
  }

  overlay.addEventListener("keydown", keydown, true);
  // Pointer movement may fire many times within one row. activateOption bounds
  // reactive class and layout work to actual row changes.
  overlay.addEventListener("pointermove", pointermove);

  return {
    update(next) {
      options = next;
    },
    destroy() {
      overlay.removeEventListener("keydown", keydown, true);
      overlay.removeEventListener("pointermove", pointermove);
    },
  };
}

export function requestModalCancel(overlay) {
  const explicit = overlay.querySelector("[data-modal-cancel]");
  if (explicit) {
    explicit.click();
    return;
  }
  const fallback = [...overlay.querySelectorAll("button")]
    .find((button) => /^(cancel|close|done|no)$/i.test(button.textContent.trim()));
  fallback?.click();
}

/** Scroll a declaratively-rendered option when it becomes keyboard-active. */
export function scrollIntoViewWhen(node, active) {
  function scroll(shouldScroll) {
    if (shouldScroll) queueMicrotask(() => node.scrollIntoView({ block: "nearest" }));
  }

  scroll(active);
  return { update: scroll };
}
