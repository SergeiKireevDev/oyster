import { createTransportRuntime } from "../runtime/transportRuntime.js";
import { createDelayedTaskRegistry } from "../runtime/delayedTaskRegistry.js";
import { createManagedEventConnection } from "./createManagedEventConnection.js";
import { createPlatformEventDispatch } from "./createPlatformEventDispatch.js";
import { createRuntimeAttachments } from "../runtime/runtimeAttachments.js";

/** Staged platform composition for transport, events, connection, timers, and debug attachments. */
export function createPlatformAssembly(deps) {
  const delayedTasks = (deps.createDelayedTasks ?? createDelayedTaskRegistry)();
  const transport = (deps.createTransport ?? createTransportRuntime)(deps.transport);
  let events;
  let connection;
  let attachments;
  return {
    transport,
    delayedTasks,
    configureEvents(config) {
      if (events) return events;
      events = (deps.createEventDispatch ?? createPlatformEventDispatch)(config);
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
    teardown() {
      attachments?.detach?.();
      connection?.coordinator?.disconnect?.();
      connection?.watchdog?.();
      delayedTasks.cancelAll();
      transport.dispose?.();
    },
  };
}
