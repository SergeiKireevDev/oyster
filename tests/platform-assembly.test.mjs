import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformAssembly } from "../public/src/platform/createPlatformAssembly.js";

test("platform assembly composes transport events connection timers and debug attachments once", () => {
  const calls = [];
  const assembly = createPlatformAssembly({
    transport: { token: true },
    createTransport: (config) => ({ config, dispose: () => calls.push("transport") }),
    createEventDispatch: (config) => ({ config, kind: "events", dispatch: (value) => `dispatch:${value}`, setReplaying: (value) => calls.push(`replay:${value}`), snapshot: () => ({ ready: true }) }),
    createConnection: (config) => ({ config, coordinator: { disconnect: () => calls.push("connection") }, watchdog: () => calls.push("watchdog") }),
    createAttachments: (config) => ({ config, detach: () => calls.push("debug") }),
  });
  assert.equal(assembly.transport.config.token, true);
  const events = assembly.configureEvents({ one: 1, featureEvents: { sessions: { sessionEvent: true }, transcript: { transcriptEvent: true } } });
  assert.equal(events, assembly.configureEvents({ one: 2 }));
  assert.deepEqual(events.config, { one: 1, sessionEvent: true, transcriptEvent: true });
  assert.equal(assembly.dispatchEvent("message"), "dispatch:message");
  assembly.setReplaying(true);
  assert.deepEqual(assembly.snapshotEvents(), { ready: true });
  assert.equal(assembly.configureConnection({ two: 2 }), assembly.configureConnection({ two: 3 }));
  assert.equal(assembly.configureAttachments({ three: 3 }), assembly.configureAttachments({ three: 4 }));
  assembly.teardown();
  assert.deepEqual(calls, ["replay:true", "debug", "connection", "watchdog", "transport"]);
});

test("platform assemblies connect disconnect and reconnect without retaining RPC EventSource or watchdog state", () => {
  const calls = [];
  const mount = (name) => {
    const assembly = createPlatformAssembly({
      transport: {},
      createTransport: () => ({ rpc: () => calls.push(`${name}:rpc`), dispose: () => calls.push(`${name}:disposeRpc`) }),
      createEventDispatch: () => ({ dispatch() {} }),
      createConnection: () => ({
        coordinator: { connect: () => calls.push(`${name}:eventSource`), disconnect: () => calls.push(`${name}:disconnect`) },
        watchdog: () => calls.push(`${name}:watchdog`),
      }),
      createAttachments: () => ({ detach: () => calls.push(`${name}:debug`) }),
    });
    assembly.configureEvents({});
    assembly.configureConnection({});
    assembly.configureAttachments({});
    return assembly;
  };
  const first = mount("first");
  first.transport.rpc();
  first.connection.coordinator.connect();
  first.teardown();
  first.teardown();
  const second = mount("second");
  second.transport.rpc();
  second.connection.coordinator.connect();
  second.teardown();
  assert.deepEqual(calls, [
    "first:rpc", "first:eventSource", "first:debug", "first:disconnect", "first:watchdog", "first:disposeRpc",
    "second:rpc", "second:eventSource", "second:debug", "second:disconnect", "second:watchdog", "second:disposeRpc",
  ]);
});
