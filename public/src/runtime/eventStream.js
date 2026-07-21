/** Create the authenticated EventSource used by the live Pi event stream. */
export function openEventStream({ token, runner, replay, EventSourceImpl = EventSource }) {
  const url = `/events?token=${encodeURIComponent(token)}&runner=${encodeURIComponent(runner ?? "")}&replay=${replay ? "1" : "0"}`;
  return new EventSourceImpl(url);
}
