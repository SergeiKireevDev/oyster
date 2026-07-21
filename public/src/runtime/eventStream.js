/** Create the authenticated EventSource used by the live Pi event stream. */
export function bindEventStreamHandlers(source, handlers) {
  Object.assign(source, handlers);
  return source;
}

export function closeEventStream(source) {
  try { source?.close(); } catch {}
}

export function openEventStream({ token, runner, replay, EventSourceImpl = EventSource }) {
  const url = `/events?token=${encodeURIComponent(token)}&runner=${encodeURIComponent(runner ?? "")}&replay=${replay ? "1" : "0"}`;
  return new EventSourceImpl(url);
}
