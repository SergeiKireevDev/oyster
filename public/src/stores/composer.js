import { derived, writable } from "svelte/store";
import { appSession } from "./appSession.js";

export const composerText = writable("");
/** Pending attachments of the visible draft: `{ id, name, path, temporary, uploading, progress }`. */
export const composerAttachments = writable([]);
export const composerVoice = writable({ available: false, listening: false, speaking: false, transcribing: false, status: "", local: false });

export function composerUiState(session, text, attachments = []) {
  const busy = !!session.busy;
  const connected = !!session.connected;
  const replaying = !!session.replayingTranscript;
  const gateRequired = session.transcriptGateRequired !== false;
  // Canonical history can continue loading behind an interactive composer.
  // Only the event replay that establishes the selected session blocks sends.
  const gated = replaying && gateRequired && session.transcriptLoadPhase !== "canonical";
  const ready = connected && !gated;
  const uploading = attachments.some((attachment) => attachment.uploading);
  // Attachments alone are a sendable message.
  const hasContent = !!String(text ?? "").trim() || attachments.some((attachment) => !attachment.uploading);
  return {
    ready,
    // Disabling a focused textarea makes the browser blur it. Background
    // reconnects and canonical syncs are transient, so keep drafting enabled
    // while independently preventing sends until the transport is ready.
    inputDisabled: false,
    sendDisabled: !ready || uploading,
    placeholder: !connected
      ? "connecting…"
      : gated && session.transcriptLoadPhase === "replay"
        ? "replaying transcript…"
        : gated
          ? "loading transcript…"
          : "Message Agent",
    sendText: busy ? "Steer" : "Send",
    sendHidden: busy && !hasContent,
    stopHidden: !busy,
  };
}

export const composerUi = derived(
  [appSession, composerText, composerAttachments],
  ([$appSession, $composerText, $composerAttachments]) => composerUiState($appSession, $composerText, $composerAttachments),
);

export function setComposerTextValue(text) {
  composerText.set(text ?? "");
}

export function setComposerAttachments(attachments) {
  composerAttachments.set(attachments ?? []);
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
