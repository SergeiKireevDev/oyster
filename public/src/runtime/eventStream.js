/** Create the authenticated EventSource used by the live Pi event stream. */
export function createEventStreamRuntime({ EventSourceImpl = EventSource } = {}) {
  let source = null;
  return {
    connect(options, handlers) {
      closeEventStream(source);
      source = openEventStream({ ...options, EventSourceImpl });
      return bindEventStreamHandlers(source, handlers);
    },
    close() { closeEventStream(source); source = null; },
    get source() { return source; },
  };
}

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
