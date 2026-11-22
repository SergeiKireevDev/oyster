/**
 * Pure view-model helpers for threads: a thread is a forked session anchored
 * to a passage quoted from a reply. The server returns one flat family (the
 * root session plus every thread under it); everything here derives rows,
 * breadcrumbs and the graph from that list without touching the DOM.
 */

/** The buttons offered on a selection. `other` asks the user to type the question. */
export const THREAD_QUESTIONS = Object.freeze([
  Object.freeze({ id: "why", label: "Why?" }),
  Object.freeze({ id: "what", label: "What?" }),
  Object.freeze({ id: "how", label: "How?" }),
  Object.freeze({ id: "other", label: "Other…" }),
]);

/** The server rejects longer quotes; a selection past this is trimmed with an ellipsis. */
export const THREAD_QUOTE_MAX_CHARS = 4000;
const SNIPPET_MAX_CHARS = 72;
const NODE_WIDTH = 208;
// Tall enough for a node's three lines: label, quote and activity.
const NODE_HEIGHT = 80;
const NODE_GAP_X = 20;
const NODE_GAP_Y = 44;

export const EMPTY_THREAD_FAMILY = Object.freeze({
  sessionKey: null,
  rootSessionKey: null,
  currentThreadId: null,
  root: null,
  threads: Object.freeze([]),
});

export function quoteSnippet(quote, maxChars = SNIPPET_MAX_CHARS) {
  const compact = String(quote ?? "").replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1).trimEnd()}…` : compact;
}

/** Normalize a raw selection into the quote sent to the server. */
export function normalizeQuote(text, maxChars = THREAD_QUOTE_MAX_CHARS) {
  const quote = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return quote.length > maxChars ? `${quote.slice(0, maxChars - 1).trimEnd()}…` : quote;
}

/** Threads opened directly on `sessionKey`, grouped by the reply they are anchored to. */
export function threadsByAnchor(threads, sessionKey) {
  const groups = new Map();
  if (!sessionKey) return groups;
  for (const thread of threads ?? []) {
    if (thread.parentSessionKey !== sessionKey || !thread.anchorEntryId) continue;
    if (!groups.has(thread.anchorEntryId)) groups.set(thread.anchorEntryId, []);
    groups.get(thread.anchorEntryId).push(thread);
  }
  return groups;
}

/** Ancestors of a thread from the outermost down to the thread itself. */
export function threadPath(threads, threadId) {
  const bySessionKey = new Map((threads ?? []).map((thread) => [thread.sessionKey, thread]));
  const path = [];
  const seen = new Set();
  let current = (threads ?? []).find((thread) => thread.id === threadId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = bySessionKey.get(current.parentSessionKey) ?? null;
  }
  return path;
}

/** A thread and everything nested beneath it. */
export function threadSubtreeIds(threads, threadId) {
  const start = (threads ?? []).find((thread) => thread.id === threadId);
  if (!start) return new Set();
  const ids = new Set([start.id]);
  const pending = [start.sessionKey];
  while (pending.length) {
    const parentKey = pending.pop();
    for (const thread of threads) {
      if (thread.parentSessionKey !== parentKey || ids.has(thread.id)) continue;
      ids.add(thread.id);
      pending.push(thread.sessionKey);
    }
  }
  return ids;
}

/** Whether any thread of a root session is working or holds an unopened result. */
export function threadFamilyActivity(runners, rootSessionKey) {
  let busy = false;
  let unread = false;
  if (!rootSessionKey) return { busy, unread };
  for (const runner of runners ?? []) {
    if (runner.thread?.rootSessionKey !== rootSessionKey) continue;
    busy ||= Boolean(runner.alive && runner.busy);
    unread ||= Boolean(runner.attentionUnread);
  }
  return { busy, unread };
}

/** The session key of the root a runner belongs to: its own, or its thread's root. */
export function runnerRootSessionKey(runner) {
  return runner?.thread?.rootSessionKey ?? runner?.sessionKey ?? null;
}

function nodeStatus(node) {
  if (node.alive && node.busy) return "busy";
  if (node.attentionUnread) return "unread";
  return node.alive ? "idle" : "dormant";
}

/**
 * Top-down tidy tree: leaves take consecutive columns and every parent sits
 * centred over its children, so edges never cross. Returns pixel boxes for an
 * SVG with the root on the first row.
 */
export function layoutThreadTree(family, { currentSessionKey = null } = {}) {
  if (!family?.root) return { nodes: [], edges: [], width: 0, height: 0 };
  const root = { ...family.root, id: "root", kind: "root", label: family.root.name || "Session", quote: "" };
  const childrenByParent = new Map();
  for (const thread of family.threads ?? []) {
    if (!childrenByParent.has(thread.parentSessionKey)) childrenByParent.set(thread.parentSessionKey, []);
    childrenByParent.get(thread.parentSessionKey).push({ ...thread, kind: "thread" });
  }

  const nodes = [];
  const edges = [];
  let nextColumn = 0;
  let maxDepth = 0;
  const visited = new Set();
  const place = (node, depth) => {
    visited.add(node.sessionKey);
    maxDepth = Math.max(maxDepth, depth);
    const children = (childrenByParent.get(node.sessionKey) ?? []).filter((child) => !visited.has(child.sessionKey));
    const columns = children.map((child) => place(child, depth + 1));
    const column = columns.length ? (columns[0] + columns.at(-1)) / 2 : nextColumn++;
    const placed = {
      id: node.id,
      kind: node.kind,
      sessionKey: node.sessionKey,
      anchorEntryId: node.anchorEntryId ?? null,
      label: node.label,
      snippet: quoteSnippet(node.quote, 54),
      messages: node.messages ?? null,
      status: nodeStatus(node),
      current: node.sessionKey === currentSessionKey,
      x: column * (NODE_WIDTH + NODE_GAP_X),
      y: depth * (NODE_HEIGHT + NODE_GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    nodes.push(placed);
    for (const child of children) edges.push({ from: node.id, to: child.id });
    return column;
  };
  place(root, 0);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes,
    edges: edges.map(({ from, to }) => {
      const parent = byId.get(from);
      const child = byId.get(to);
      const startX = parent.x + parent.width / 2;
      const startY = parent.y + parent.height;
      const endX = child.x + child.width / 2;
      const middleY = (startY + child.y) / 2;
      return { id: `${from}:${to}`, path: `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${child.y}` };
    }),
    width: Math.max(1, nextColumn) * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X,
    height: (maxDepth + 1) * (NODE_HEIGHT + NODE_GAP_Y) - NODE_GAP_Y,
  };
}

/**
 * Read a text selection as a thread anchor. The selection must lie inside the
 * rendered text of a single reply; `entryOf` maps a node to that reply's
 * element (or null) so the DOM lookup stays with the caller.
 */
export function readThreadSelection(selection, entryOf) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const quote = normalizeQuote(selection.toString());
  if (!quote) return null;
  const range = selection.getRangeAt(0);
  const entry = entryOf(range.startContainer);
  if (!entry || entry !== entryOf(range.endContainer)) return null;
  return { entry, quote, rect: range.getBoundingClientRect() };
}
