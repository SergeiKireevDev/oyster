import { createEventSourceTransport } from "./createEventSourceTransport.js";
import { createConnectionStateTransitions, registerReconnectWatchdog } from "../runtime/eventStream.js";
import { createEventConnectionController } from "../runtime/eventConnectionController.js";
import { createPlatformConnection } from "./createPlatformConnection.js";

export function createManagedEventConnection(deps) {
  let es = null;
  let lastEventAt = Date.now();
  const stream = createEventSourceTransport();
  const state = createConnectionStateTransitions({ setConnected: deps.setConnected, setStatus: deps.setStatus });
  let coordinator;
  const watchdog = registerReconnectWatchdog({ getSource: () => es, getLastEventAt: () => lastEventAt, onExpired: () => { stream.close(); state.lost(); coordinator.connect(); } });
  const connect = createEventConnectionController({
    getToken: deps.getToken, requireToken: deps.requireToken, close: () => stream.close(),
    setLastEventAt: (value) => { lastEventAt = value; }, setGate: deps.setGate, setReplaying: deps.setReplaying,
    setReplayDoneSeen: deps.setReplayDoneSeen, setReplayBuffer: deps.setReplayBuffer,
    getSkipTranscriptGate: deps.getSkipTranscriptGate, log: deps.log,
    connect: (options, handlers) => stream.connect({ ...options, runner: deps.getRunner() }, handlers), setSource: (source) => { es = source; },
    onOpen: deps.onOpen, onError: deps.onError, onMessage: deps.onMessage,
  });
  coordinator = createPlatformConnection({ connect, disconnect: () => stream.close(), refreshState: deps.refreshState, dispatch: deps.dispatch });
  return { coordinator, watchdog, state };
}
