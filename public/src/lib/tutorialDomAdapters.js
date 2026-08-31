const EDGE_GAP = 14;
const TARGET_GAP = 14;
const TARGET_PADDING = 6;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function visibleTarget(documentTarget, selectors) {
  for (const selector of selectors ?? []) {
    const element = documentTarget.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const style = documentTarget.defaultView?.getComputedStyle(element);
    if (rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden") {
      return rect;
    }
  }
  return null;
}

/**
 * Owns the tutorial's viewport geometry, focus lifecycle, and keyboard behavior.
 * The Svelte component supplies intent callbacks and remains declarative.
 */
export function tutorialPresentation(node, options) {
  const documentTarget = node.ownerDocument;
  const windowTarget = documentTarget.defaultView;
  const card = node.querySelector(".tutorial-card");
  const spotlight = node.querySelector(".tutorial-spotlight");
  const scrim = node.querySelector(".tutorial-scrim");
  const previousFocus = documentTarget.activeElement;
  let current = options;
  let scheduledFrame = null;
  let destroyed = false;

  function positionCard(left, top, viewportWidth, viewportHeight) {
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    card.style.left = `${clamp(left, EDGE_GAP, viewportWidth - cardWidth - EDGE_GAP)}px`;
    card.style.top = `${clamp(top, EDGE_GAP, viewportHeight - cardHeight - EDGE_GAP)}px`;
    card.style.opacity = "1";
    card.style.transform = "translateY(0)";
  }

  function measure() {
    scheduledFrame = null;
    if (destroyed) return;
    const viewportWidth = documentTarget.documentElement.clientWidth;
    const viewportHeight = documentTarget.documentElement.clientHeight;
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const target = visibleTarget(documentTarget, current.targets);

    if (!target) {
      scrim.style.display = "block";
      spotlight.style.display = "none";
      positionCard((viewportWidth - cardWidth) / 2, (viewportHeight - cardHeight) / 2, viewportWidth, viewportHeight);
      return;
    }

    scrim.style.display = "none";
    spotlight.style.display = "block";
    spotlight.style.left = `${clamp(target.left - TARGET_PADDING, 4, viewportWidth - 4)}px`;
    spotlight.style.top = `${clamp(target.top - TARGET_PADDING, 4, viewportHeight - 4)}px`;
    spotlight.style.width = `${clamp(target.width + TARGET_PADDING * 2, 0, viewportWidth - 8)}px`;
    spotlight.style.height = `${clamp(target.height + TARGET_PADDING * 2, 0, viewportHeight - 8)}px`;

    let left;
    let top;
    if (target.right + TARGET_GAP + cardWidth <= viewportWidth - EDGE_GAP) {
      left = target.right + TARGET_GAP;
      top = target.top + (target.height - cardHeight) / 2;
    } else if (target.left - TARGET_GAP - cardWidth >= EDGE_GAP) {
      left = target.left - TARGET_GAP - cardWidth;
      top = target.top + (target.height - cardHeight) / 2;
    } else if (target.bottom + TARGET_GAP + cardHeight <= viewportHeight - EDGE_GAP) {
      left = target.left + (target.width - cardWidth) / 2;
      top = target.bottom + TARGET_GAP;
    } else {
      left = target.left + (target.width - cardWidth) / 2;
      top = target.top - TARGET_GAP - cardHeight;
    }
    positionCard(left, top, viewportWidth, viewportHeight);
  }

  function scheduleMeasure() {
    if (scheduledFrame !== null) windowTarget.cancelAnimationFrame(scheduledFrame);
    scheduledFrame = windowTarget.requestAnimationFrame(measure);
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      current.onDismiss();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      current.onNext();
      return;
    }
    if (event.key === "ArrowLeft" && current.stepIndex > 0) {
      event.preventDefault();
      current.onPrevious();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = [...card.querySelectorAll("button:not(:disabled)")];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (event.target === first || event.target === card)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  }

  card.addEventListener("keydown", handleKeydown);
  windowTarget.addEventListener("resize", scheduleMeasure);
  queueMicrotask(() => {
    if (!destroyed) card.focus();
  });
  scheduleMeasure();

  return {
    update(next) {
      current = next;
      card.style.opacity = "0";
      card.style.transform = "translateY(4px)";
      scheduleMeasure();
    },
    destroy() {
      destroyed = true;
      card.removeEventListener("keydown", handleKeydown);
      windowTarget.removeEventListener("resize", scheduleMeasure);
      if (scheduledFrame !== null) windowTarget.cancelAnimationFrame(scheduledFrame);
      const returnTarget = previousFocus?.isConnected && previousFocus !== documentTarget.body
        ? previousFocus
        : documentTarget.querySelector("#input");
      returnTarget?.focus?.();
    },
  };
}
