import { createExtensionUiEventController, createHublotEventController, createReplayDoneEventController, createRunnerPingEventController, createRoutineStreamEventController, createRunnersUpdateController } from "../runtime/eventControllers.js";
import { createCodeReloadController, createPiErrorController, createResponseEventController, createPiStartedController, createReplayEventGate, createRunnerUnhealthyController, createRunnerExitController, eventLifecycleLogged, stateRefreshRequired } from "../runtime/eventStream.js";
import { createReplayBufferFlusher, isComposerReadyForSend, REPLAY_GATED_EVENT_TYPES } from "../runtime/transcriptRuntime.js";

export function createPlatformEventDispatch(deps) {
  let replaying = true;
  let replayDoneSeen = false;
  let replayBufferedEvents = [];

  function setReplaying(value, phase = null) {
    const next = !!value;
    if (replaying !== next || phase) deps.log("setReplaying", { from: replaying, to: next, phase });
    replaying = next;
    deps.updateReplayState(replaying, phase);
  }

  const flushBufferedEvents = createReplayBufferFlusher({
    log: deps.log,
    assistantAlreadyRendered: deps.assistantAlreadyRendered,
    dispatch,
  });

  const extensionUiEvent = createExtensionUiEventController({ handleRequest: deps.handleExtensionUI });
  const replayDoneEvent = createReplayDoneEventController({
    markReplayDone: () => { replayDoneSeen = true; },
    isReplaying: () => replaying,
    setReplaying,
    setRunner: deps.setRunner,
    setRunners: deps.setRunners,
    setWorkdir: deps.setWorkdir,
    refreshHublots: deps.refreshHublots,
    refreshRoutines: deps.refreshRoutines,
  });
  const runnerPingEvent = createRunnerPingEventController({ currentRunners: deps.getRunners, setRunners: deps.setRunners, onRunnersChanged: deps.onRunnersChanged, refreshTree: deps.refreshTree });
  const runnersUpdate = createRunnersUpdateController({ setRunners: deps.setRunners, onRunnersChanged: deps.onRunnersChanged, refreshTree: deps.refreshTree });
  const routineEvent = createRoutineStreamEventController({ isReplaying: () => replaying, update: deps.updateRoutine, toast: deps.toast });
  const hublotEvent = createHublotEventController({ isReplaying: () => replaying, toast: deps.toast, refreshHublots: deps.refreshHublots, scheduleRefresh: deps.scheduleRefresh, openUrl: deps.openUrl });
  const responseEvent = createResponseEventController({ handleResponse: deps.handleResponse, refreshRequired: stateRefreshRequired, refreshState: deps.refreshState });
  const codeReload = createCodeReloadController({ isReplaying: () => replaying, toast: deps.toast, reloadPage: deps.reloadPage });
  const piStarted = createPiStartedController({ isReplaying: () => replaying, toast: deps.toast, reloadTranscript: deps.reloadTranscript });
  const runnerUnhealthy = createRunnerUnhealthyController({ isReplaying: () => replaying, toast: deps.toast, setBusy: deps.setBusy });
  const piError = createPiErrorController({ isReplaying: () => replaying, toast: deps.toast });
  const runnerExit = createRunnerExitController({ isReplaying: () => replaying, toast: deps.toast, setBusy: deps.setBusy });
  const replayEventGate = createReplayEventGate({
    isReplaying: () => replaying,
    isGateRequired: deps.isGateRequired,
    isReplayDone: () => replayDoneSeen,
    buffer: (message) => replayBufferedEvents.push(message),
    gatedTypes: REPLAY_GATED_EVENT_TYPES,
    log: deps.log,
  });

  function dispatch(msg) {
    if (eventLifecycleLogged(msg.type)) deps.log("sse:event", { type: msg.type, command: msg.command, sseId: msg._sseId, role: msg.message?.role, runner: msg.runner });
    if (replayEventGate(msg)) return;
    switch (msg.type) {
      case "ping": return runnerPingEvent(msg);
      case "replay_done": return replayDoneEvent(msg);
      case "runners_update": return runnersUpdate(msg);
      case "response": return responseEvent(msg);
      case "agent_start": return deps.agentStart();
      case "agent_end": return deps.agentCompletion();
      case "message_start":
      case "message_update":
      case "message_end":
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": return deps.transcriptDispatch(msg);
      case "extension_ui_request": return extensionUiEvent(msg);
      case "pi_exit": return runnerExit();
      case "pi_started": return piStarted(msg);
      case "pi_error": return piError(msg);
      case "runner_unhealthy": return runnerUnhealthy(msg);
      case "ui_reload":
      case "code_reloaded":
      case "code_reload_failed": return codeReload(msg);
      case "tunnel_opened":
      case "hublot_ready":
      case "hublot_failed":
      case "tunnel_closed": return hublotEvent(msg);
      case "routine_update": return routineEvent(msg);
    }
  }

  return {
    dispatch,
    setReplaying,
    isReplaying: () => replaying,
    markReplayDone: (value) => { replayDoneSeen = value; },
    setReplayBuffer: (value) => { replayBufferedEvents = value; },
    takeBufferedEvents: () => { const buffered = replayBufferedEvents; replayBufferedEvents = []; return buffered; },
    flushBufferedEvents,
    isComposerReady: (connected, gateRequired) => isComposerReadyForSend({ connected, replaying, transcriptGateRequired: gateRequired }),
    snapshot: () => ({ replaying, replayDoneSeen }),
  };
}
