import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

const EMPTY_FAMILY = Object.freeze({
  sessionKey: null,
  rootSessionKey: null,
  currentThreadId: null,
  root: null,
  threads: Object.freeze([]),
});

/** The family (root session plus every thread) the open session belongs to, as last fetched. */
export const threadFamily = writable(EMPTY_FAMILY);

/** A thread being composed from "Other…": nothing exists on the server until it is sent. */
export const threadDraft = writable(null);

/** True while a thread is being created, so the question buttons cannot fire twice. */
export const threadPending = writable(false);

/**
 * Replies whose thread list is open, as "<session key>\n<entry id>". Kept out of
 * the row component because the transcript re-renders (and recreates its
 * components) whenever it is reloaded; an opened list must stay open.
 */
export const expandedThreadAnchors = writable(new Set());

export function threadAnchorKey(sessionKey, entryId) {
  return `${sessionKey ?? ""}\n${entryId ?? ""}`;
}

export function toggleThreadAnchor(key) {
  expandedThreadAnchors.update((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
}

export function setThreadFamily(family) {
  threadFamily.set(family ? { ...EMPTY_FAMILY, ...family } : EMPTY_FAMILY);
}

export function resetThreadFamily() {
  threadFamily.set(EMPTY_FAMILY);
}

function liveStatus(node, runnerBySessionKey) {
  const runner = runnerBySessionKey.get(node.sessionKey);
  if (!runner) return node;
  return {
    ...node,
    runnerId: runner.id,
    alive: Boolean(runner.alive),
    busy: Boolean(runner.busy),
    attentionStatus: runner.attentionStatus ?? null,
    attentionUnread: Boolean(runner.attentionUnread),
  };
}

/**
 * The fetched family with each node's activity taken from the live runner
 * list, so dots and spinners follow the agents without refetching the tree.
 */
export const threadView = derived([threadFamily, appSession], ([family, session]) => {
  const runnerBySessionKey = new Map((session.runners ?? []).filter((runner) => runner.sessionKey).map((runner) => [runner.sessionKey, runner]));
  const current = (session.runners ?? []).find((runner) => runner.id === session.currentRunner) ?? null;
  const sessionKey = current?.sessionKey ?? null;
  // A family fetched for another session must not decorate this transcript.
  const fresh = Boolean(sessionKey) && family.sessionKey === sessionKey;
  const threads = fresh ? family.threads.map((thread) => liveStatus(thread, runnerBySessionKey)) : [];
  return {
    sessionKey,
    rootSessionKey: fresh ? family.rootSessionKey : null,
    root: fresh && family.root ? liveStatus(family.root, runnerBySessionKey) : null,
    threads,
    current: fresh ? threads.find((thread) => thread.id === family.currentThreadId) ?? null : null,
    harness: current?.harness ?? null,
    busy: Boolean(session.busy),
  };
});
