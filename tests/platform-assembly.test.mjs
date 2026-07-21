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
