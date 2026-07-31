<script>
  import { onDestroy } from "svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import { appHeader } from "../stores/appSession.js";
  import { composerText, composerUi, composerVoice } from "../stores/composer.js";
  import { headerState } from "../stores/header.js";
  import { composerHighlightSegments } from "../lib/composerHighlight.js";
  import { createFrameScheduler } from "../lib/frameScheduler.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    COMPOSER_ABORT_ACTION,
    COMPOSER_INPUT_ACTION,
    COMPOSER_KEYDOWN_ACTION,
    COMPOSER_SEND_ACTION,
    COMPOSER_VOICE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let highlight;
  const highlightScroll = createFrameScheduler((top, left) => {
    if (!highlight) return;
    highlight.scrollTop = top;
    highlight.scrollLeft = left;
  });
  const scheduleHighlightScroll = (input) => highlightScroll.schedule(input.scrollTop, input.scrollLeft);
  const handleInput = (event) => {
    uiActions.invoke(COMPOSER_INPUT_ACTION);
    scheduleHighlightScroll(event.currentTarget);
  };
  const handleScroll = (event) => scheduleHighlightScroll(event.currentTarget);
  const handleKeydown = (event) => uiActions.invoke(COMPOSER_KEYDOWN_ACTION, event);
  const send = () => uiActions.invoke(COMPOSER_SEND_ACTION);
  const abort = () => uiActions.invoke(COMPOSER_ABORT_ACTION);
  const toggleVoice = () => uiActions.invoke(COMPOSER_VOICE_ACTION);

  onDestroy(highlightScroll.cancel);

  $: highlightSegments = composerHighlightSegments($composerText);
  $: voiceButtonLabel = $composerVoice.transcribing
    ? "Transcribing voice input"
    : $composerVoice.listening ? "Stop voice input" : "Start voice input";
  $: voiceButtonTitle = $composerVoice.transcribing
    ? $composerVoice.status
    : $composerVoice.listening
      ? "Stop listening"
      : $composerVoice.local ? "Record with on-device Whisper" : "Dictate message";
</script>

<div id="composer">
  <form class="inner" onsubmit={(event) => { event.preventDefault(); send(); }}>
    <div class="composer-prompt" aria-hidden="true">›</div>
    <div class="composer-editor">
      <pre class="composer-highlight" aria-hidden="true" bind:this={highlight}>{#each highlightSegments as segment (segment)}<span class:code={segment.type === "code"} class:fence={segment.type === "fence"}>{segment.text}</span>{/each}</pre>
      <textarea
        id="input"
        aria-label="Message"
        rows="1"
        placeholder={$composerUi.placeholder}
        disabled={$composerUi.inputDisabled}
        oninput={handleInput}
        onscroll={handleScroll}
        onkeydown={handleKeydown}
      ></textarea>
    </div>
    {#if $composerVoice.available}
      <button
        class:recording={$composerVoice.listening}
        class:speaking={$composerVoice.speaking}
        class:transcribing={$composerVoice.transcribing}
        class="voice-btn"
        id="voiceBtn"
        type="button"
        disabled={$composerVoice.transcribing}
        aria-label={voiceButtonLabel}
        aria-pressed={$composerVoice.listening}
        title={voiceButtonTitle}
        onclick={toggleVoice}
      >
        {#if $composerVoice.transcribing}
          <span class="voice-loading" aria-hidden="true"></span>
        {:else if $composerVoice.speaking}
          <span class="voice-waveform" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-7-3a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 12Z"/></svg>
        {/if}
      </button>
    {/if}
    <button class="btn" id="sendBtn" type="submit" hidden={$composerUi.sendHidden} disabled={$composerUi.sendDisabled}>{$composerUi.sendText}</button>
    <button class="btn stop" id="stopBtn" type="button" hidden={$composerUi.stopHidden} onclick={abort}>Stop</button>
  </form>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    {#if $composerVoice.status}<span id="voiceStatus" role="status" aria-atomic="true">{$composerVoice.status}</span>{/if}
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{#if $appHeader.workdirText}<FolderIcon size={11} />{/if}{$appHeader.workdirText}</span>
  </div>
</div>
