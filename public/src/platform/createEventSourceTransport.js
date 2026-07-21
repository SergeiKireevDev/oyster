import { createEventStreamRuntime } from "../runtime/eventStream.js";

/** Platform-owned EventSource transport construction. */
export function createEventSourceTransport() {
  return createEventStreamRuntime();
}
