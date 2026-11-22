/**
 * Tint the passages a reply's threads quote, in place, without touching the
 * rendered Markdown: the CSS Custom Highlight API paints ranges that live
 * outside the DOM tree. It is a best-effort decoration. A quote that cannot be
 * found exactly once in the reply (reflowed, ambiguous, or truncated) is simply
 * left unmarked, and browsers without the API show no highlight at all.
 */

const HIGHLIGHT_NAME = "thread-quote";
const MIN_QUOTE_CHARS = 3;
const REPLY_TEXT_SELECTOR = '[data-assistant-part="text"]';
const TEXT_NODE_FILTER = 4; // NodeFilter.SHOW_TEXT

/**
 * Find `quote` in the concatenated text of `textNodes`, ignoring whitespace: a
 * selection reads block boundaries as line breaks that no text node contains.
 * Returns the range boundaries, or null when the quote is absent or occurs
 * more than once.
 */
export function locateQuote(textNodes, quote) {
  const needle = String(quote ?? "").replace(/\s+/g, "");
  if (needle.length < MIN_QUOTE_CHARS) return null;
  let haystack = "";
  const positions = [];
  textNodes.forEach((node, nodeIndex) => {
    const text = node.textContent ?? "";
    for (let offset = 0; offset < text.length; offset++) {
      if (/\s/.test(text[offset])) continue;
      haystack += text[offset];
      positions.push([nodeIndex, offset]);
    }
  });
  const start = haystack.indexOf(needle);
  if (start === -1 || haystack.indexOf(needle, start + 1) !== -1) return null;
  const [startNode, startOffset] = positions[start];
  const [endNode, endOffset] = positions[start + needle.length - 1];
  return { startNode: textNodes[startNode], startOffset, endNode: textNodes[endNode], endOffset: endOffset + 1 };
}

function replyTextNodes(reply) {
  const nodes = [];
  for (const part of reply.querySelectorAll(REPLY_TEXT_SELECTOR)) {
    const walker = reply.ownerDocument.createTreeWalker(part, TEXT_NODE_FILTER);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  }
  return nodes;
}

/**
 * Svelte action for the thread list rendered directly after a reply: marks
 * the passages in that reply which `quotes` were taken from, and removes its
 * marks again when the list goes away.
 */
export function highlightThreadQuotes(node, quotes) {
  const view = node.ownerDocument.defaultView;
  const registry = view?.CSS?.highlights;
  if (!registry || typeof view.Highlight !== "function") return {};
  let ranges = [];
  let frame = null;

  function clear() {
    const highlight = registry.get(HIGHLIGHT_NAME);
    for (const range of ranges) highlight?.delete(range);
    ranges = [];
  }

  function apply(list) {
    clear();
    const reply = node.previousElementSibling;
    if (!reply || !list?.length) return;
    const textNodes = replyTextNodes(reply);
    let highlight = registry.get(HIGHLIGHT_NAME);
    if (!highlight) {
      highlight = new view.Highlight();
      registry.set(HIGHLIGHT_NAME, highlight);
    }
    for (const quote of list) {
      const found = locateQuote(textNodes, quote);
      if (!found) continue;
      const range = node.ownerDocument.createRange();
      range.setStart(found.startNode, found.startOffset);
      range.setEnd(found.endNode, found.endOffset);
      highlight.add(range);
      ranges.push(range);
    }
  }

  function schedule(list) {
    if (frame !== null) view.cancelAnimationFrame(frame);
    // The reply's Markdown is in place one frame after the list mounts or changes.
    frame = view.requestAnimationFrame(() => {
      frame = null;
      apply(list);
    });
  }

  schedule(quotes);
  return {
    update: schedule,
    destroy() {
      if (frame !== null) view.cancelAnimationFrame(frame);
      clear();
    },
  };
}
