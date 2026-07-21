import { createTransportRuntime } from "../runtime/transportRuntime.js";
import { createManagedEventConnection } from "./createManagedEventConnection.js";
import { createPlatformEventDispatch } from "./createPlatformEventDispatch.js";
import { createRuntimeAttachments } from "../runtime/runtimeAttachments.js";

/** Staged platform composition for transport, events, connection, timers, and debug attachments. */
export function createPlatformAssembly(deps) {
  const transport = (deps.createTransport ?? createTransportRuntime)(deps.transport);
  let events;
  let connection;
  let attachments;
  let tornDown = false;
  return {
    transport,
    configureEvents(config) {
      if (events) return events;
      const { featureEvents, ...platformEvents } = config;
      const eventDependencies = featureEvents
        ? Object.assign(platformEvents, ...Object.values(featureEvents))
        : config;
      events = (deps.createEventDispatch ?? createPlatformEventDispatch)(eventDependencies);
      return events;
    },
    configureConnection(config) {
      if (connection) return connection;
      connection = (deps.createConnection ?? createManagedEventConnection)(config);
      return connection;
    },
    configureAttachments(config) {
      if (attachments) return attachments;
      attachments = (deps.createAttachments ?? createRuntimeAttachments)(config);
      return attachments;
    },
    get events() { return events; },
    get connection() { return connection; },
    dispatchEvent: (...args) => events?.dispatch(...args),
    setReplaying: (...args) => events?.setReplaying(...args),
    snapshotEvents: () => events?.snapshot(),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      attachments?.detach?.();
      connection?.coordinator?.disconnect?.();
      connection?.watchdog?.();
      transport.dispose?.();
    },
  };
}
