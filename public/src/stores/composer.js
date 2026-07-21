import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

export const composerText = writable("");

export const composerUi = derived([appSession, composerText], ([$appSession, $composerText]) => {
  const busy = !!$appSession.busy;
  const connected = !!$appSession.connected;
  const replaying = !!$appSession.replayingTranscript;
  const gateRequired = $appSession.transcriptGateRequired !== false;
  const gated = replaying && gateRequired;
  const ready = connected && !gated;
  const hasText = !!String($composerText ?? "").trim();
  return {
    ready,
    inputDisabled: !ready,
    sendDisabled: !ready,
    placeholder: !connected
      ? "connecting…"
      : gated && $appSession.transcriptLoadPhase === "replay"
        ? "replaying transcript…"
        : gated && $appSession.transcriptLoadPhase === "canonical"
          ? "loading canonical transcript…"
          : gated
            ? "loading transcript…"
            : "message (type : for commands)",
    sendText: busy ? "Steer" : "Send",
    sendHidden: busy && !hasText,
    stopHidden: !busy,
  };
});

export function setComposerTextValue(text) {
  composerText.set(text ?? "");
}
