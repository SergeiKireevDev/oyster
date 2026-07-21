import { createTranscriptFeature } from "./createTranscriptFeature.js";
import { createTranscriptPermalinkRuntime, flashTranscriptElement, focusTranscriptSnippet } from "../../runtime/transcriptRuntime.js";
import { messageEntryMatchesElement } from "../../lib/messageUtils.js";
import { alignedTranscriptIndex } from "../../lib/transcriptUtils.js";

export function createTranscriptRuntime(deps) {
  const feature = createTranscriptFeature({
    createRuntime: () => ({ reloadForSession: deps.reloadTranscript, handleStreamEvent: deps.handleStreamEvent }),
    dependencies: {},
    domAdapter: deps.domAdapter,
  });

  const flash = flashTranscriptElement;
  const focusMessageBySnippet = (snippet) => focusTranscriptSnippet(deps.messageElements(), snippet, { flash });
  const permalink = createTranscriptPermalinkRuntime({
    fetchEntries: deps.fetchEntries,
    elements: deps.transcriptElements,
    matches: messageEntryMatchesElement,
    findDirect: deps.findDirect,
    alignedIndex: alignedTranscriptIndex,
    flash,
    toast: deps.toast,
    getSessionId: deps.getSessionId,
    getOrigin: deps.getOrigin,
    copy: deps.copy,
    prompt: deps.prompt,
  });

  return {
    feature,
    flash,
    focusMessageBySnippet,
    annotateTranscriptEntries: permalink.annotate,
    copyPermalink: permalink.copyPermalink,
    focusEntryById: permalink.focusEntryById,
    teardown: () => feature.teardown(),
  };
}
