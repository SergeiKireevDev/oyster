import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

export const composerText = writable("");
export const composerVoice = writable({ available: false, listening: false, speaking: false, transcribing: false, status: "", local: false });

export function composerUiState(session, text) {
  const busy = !!session.busy;
  const connected = !!session.connected;
  const replaying = !!session.replayingTranscript;
  const gateRequired = session.transcriptGateRequired !== false;
  const gated = replaying && gateRequired;
  const ready = connected && !gated;
  const hasText = !!String(text ?? "").trim();
  return {
    ready,
    // Disabling a focused textarea makes the browser blur it. Background
    // reconnects and canonical syncs are transient, so keep drafting enabled
    // while independently preventing sends until the transport is ready.
    inputDisabled: false,
    sendDisabled: !ready,
    placeholder: !connected
      ? "connecting…"
      : gated && session.transcriptLoadPhase === "replay"
        ? "replaying transcript…"
        : gated && session.transcriptLoadPhase === "canonical"
          ? "loading canonical transcript…"
          : gated
            ? "loading transcript…"
            : "message",
    sendText: busy ? "Steer" : "Send",
    sendHidden: busy && !hasText,
    stopHidden: !busy,
  };
}

export const composerUi = derived([appSession, composerText], ([$appSession, $composerText]) => composerUiState($appSession, $composerText));

export function setComposerTextValue(text) {
  composerText.set(text ?? "");
}

export function setComposerVoiceState(state) {
  composerVoice.set({
    available: !!state?.available,
    listening: !!state?.listening,
    speaking: !!state?.speaking,
    transcribing: !!state?.transcribing,
    status: String(state?.status ?? ""),
    local: !!state?.local,
  });
}
