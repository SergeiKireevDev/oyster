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
  let aborting = false;
  const highlightScroll = createFrameScheduler((top, left) => {
    if (!highlight) return;
    highlight.scrollTop = top;
    highlight.scrollLeft = left;
  });
  function scheduleHighlightScroll(input) {
    highlightScroll.schedule(input.scrollTop, input.scrollLeft);
  }

  function handleInput(event) {
    uiActions.invoke(COMPOSER_INPUT_ACTION);
    scheduleHighlightScroll(event.currentTarget);
  }

  function handleScroll(event) {
    scheduleHighlightScroll(event.currentTarget);
  }

  function handleKeydown(event) {
    uiActions.invoke(COMPOSER_KEYDOWN_ACTION, event);
  }

  function handleSubmit(event) {
    event.preventDefault();
    uiActions.invoke(COMPOSER_SEND_ACTION);
  }

  async function abort() {
    if (aborting) return;
    aborting = true;
    try {
      await uiActions.invoke(COMPOSER_ABORT_ACTION);
    } finally {
      aborting = false;
    }
  }

  function toggleVoice() {
    uiActions.invoke(COMPOSER_VOICE_ACTION);
  }

  function highlightSegmentKey(segment, index) {
    // Highlight segments are ordered text ranges and never reorder. Combining
    // their position and role preserves unaffected DOM nodes as the draft grows.
    return `${index}:${segment.type}`;
  }

  function voiceIsStarting(voice) {
    return !voice.listening && !voice.transcribing && Boolean(voice.status);
  }

  function voiceLabel(voice) {
    if (voice.transcribing) return "Transcribing voice input";
    if (voiceIsStarting(voice)) return voice.status;
    return voice.listening ? "Stop voice input" : "Start voice input";
  }

  function voiceTitle(voice) {
    if (voice.transcribing) return voice.status || "Transcribing voice input";
    if (voiceIsStarting(voice)) return voice.status;
    if (voice.listening) return "Stop listening";
    return voice.local ? "Record with on-device Whisper" : "Dictate message";
  }

  onDestroy(highlightScroll.cancel);

  $: highlightSegments = composerHighlightSegments($composerText);
  $: voiceStarting = voiceIsStarting($composerVoice);
  $: voiceButtonLabel = voiceLabel($composerVoice);
  $: voiceButtonTitle = voiceTitle($composerVoice);
  $: voiceButtonDisabled = $composerVoice.transcribing || voiceIsStarting($composerVoice);
</script>

<div id="composer">
  <form class="inner" onsubmit={handleSubmit} aria-label="Message composer">
    <div class="composer-prompt" aria-hidden="true">›</div>
    <div class="composer-editor" class:input-disabled={$composerUi.inputDisabled}>
      <pre class="composer-highlight" aria-hidden="true" bind:this={highlight}>{#each highlightSegments as segment, index (highlightSegmentKey(segment, index))}<span class:code={segment.type === "code"} class:fence={segment.type === "fence"}>{segment.text}</span>{/each}</pre>
      <textarea
        id="input"
        aria-label="Message"
        rows="1"
        enterkeyhint="send"
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
        class:starting={voiceStarting}
        class="voice-btn"
        id="voiceBtn"
        type="button"
        disabled={voiceButtonDisabled}
        aria-label={voiceButtonLabel}
        aria-controls="input"
        aria-pressed={$composerVoice.listening}
        aria-busy={voiceButtonDisabled}
        title={voiceButtonTitle}
        onclick={toggleVoice}
      >
        {#if voiceButtonDisabled}
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
    <button class="btn stop" id="stopBtn" type="button" hidden={$composerUi.stopHidden} disabled={aborting} aria-label="Stop agent" aria-busy={aborting} onclick={abort}>{aborting ? "Stopping…" : "Stop"}</button>
  </form>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    {#if $composerVoice.status}<span id="voiceStatus" role="status" aria-atomic="true">{$composerVoice.status}</span>{/if}
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{#if $appHeader.workdirText}<FolderIcon size={11} />{/if}{$appHeader.workdirText}</span>
  </div>
</div>

<style>
  #composer {
    flex-shrink: 0;
    padding: 10px 20px calc(16px + env(safe-area-inset-bottom));
    border-top: 0;
    background: linear-gradient(0deg, var(--bg) 55%, color-mix(in srgb, var(--bg) 90%, transparent) 78%, transparent);
  }

  .inner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 900px;
    min-height: 54px;
    margin: 0 auto;
    padding: 6px 7px 6px 14px;
    border: 1px solid color-mix(in srgb, var(--text) 10%, var(--border));
    border-radius: 17px;
    background: color-mix(in srgb, var(--panel-2) 96%, transparent);
    box-shadow: 0 14px 38px color-mix(in srgb, var(--bg) 68%, transparent), inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
    transition: border-color .16s, box-shadow .16s;
  }

  .inner:focus-within {
    border-color: color-mix(in srgb, var(--accent) 52%, var(--border));
    box-shadow: 0 16px 42px color-mix(in srgb, var(--bg) 72%, transparent), 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .composer-prompt {
    flex: none;
    align-self: flex-start;
    margin-top: 8px;
    color: var(--accent);
    font: 500 23px/1 var(--mono);
  }

  .composer-editor {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .composer-highlight {
    position: absolute;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 9px 4px;
    overflow: hidden;
    color: var(--text);
    font: inherit;
    /* iOS zooms focused form controls whose text is smaller than 16px. */
    font-size: 16px;
    line-height: 1.45;
    overflow-wrap: break-word;
    pointer-events: none;
    white-space: pre-wrap;
  }

  .composer-highlight .code {
    color: color-mix(in srgb, var(--text) 82%, var(--accent));
    background: color-mix(in srgb, var(--accent) 11%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 11%, transparent);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .composer-highlight .fence {
    color: var(--accent);
    font-weight: 600;
  }

  #input {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 40px;
    max-height: 200px;
    padding: 9px 4px;
    overflow-y: hidden;
    border: 0;
    border-radius: 0;
    outline: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--text);
    font: inherit;
    /* Keep this in sync with the highlight layer and prevent iOS focus zoom. */
    font-size: 16px;
    line-height: 1.45;
    resize: none;
  }

  #input:focus {
    border: 0;
  }

  #input:disabled {
    cursor: not-allowed;
  }

  #input::placeholder {
    color: var(--muted);
  }

  #input::selection {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .input-disabled .composer-highlight {
    opacity: .45;
  }

  .voice-btn {
    display: grid;
    width: 40px;
    height: 40px;
    flex: none;
    padding: 9px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: color .15s, background .15s, box-shadow .15s, transform .15s;
  }

  .voice-btn svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: currentColor;
  }

  .voice-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-hover);
    transform: translateY(-1px);
  }

  .voice-btn.recording {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
    animation: voice-pulse 1.4s ease-in-out infinite;
  }

  .voice-btn.speaking:not(.recording) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .voice-btn:is(.transcribing, .starting) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    animation: none;
  }

  .voice-btn:disabled {
    opacity: .65;
    cursor: wait;
  }

  .voice-waveform {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 20px;
  }

  .voice-waveform i {
    width: 3px;
    height: 5px;
    border-radius: 2px;
    background: currentColor;
    animation: voice-wave .72s ease-in-out infinite alternate;
  }

  .voice-waveform i:nth-child(2),
  .voice-waveform i:nth-child(4) {
    animation-delay: -.24s;
  }

  .voice-waveform i:nth-child(3) {
    animation-delay: -.48s;
  }

  .voice-loading {
    display: block;
    width: 18px;
    height: 18px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: voice-spin .8s linear infinite;
  }

  #statusbar {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    max-width: 900px;
    min-width: 0;
    margin: 7px auto 0;
    padding: 0 5px;
    color: var(--muted);
    font-size: 10px;
  }

  #statusbar span {
    min-width: 0;
  }

  #statusbar span + span::before {
    content: "·";
    margin-right: 9px;
    color: color-mix(in srgb, var(--muted) 62%, transparent);
  }

  #voiceStatus {
    overflow-wrap: anywhere;
  }

  #workdirInfo {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes voice-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes voice-pulse {
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--red) 8%, transparent); }
  }

  @keyframes voice-wave {
    from { height: 5px; }
    to { height: 19px; }
  }

  @media (max-width: 760px) {
    #composer {
      padding: 8px 10px calc(11px + env(safe-area-inset-bottom));
    }

    .inner {
      min-height: 50px;
      padding-left: 11px;
      border-radius: 15px;
    }

    .composer-prompt {
      display: none;
    }

    #input,
    .composer-highlight {
      padding-left: 3px;
    }

    .inner .btn {
      min-height: 40px;
    }

    #statusbar {
      padding-inline: 4px;
      overflow: hidden;
      white-space: nowrap;
    }
  }

  @media (max-width: 520px) {
    .inner {
      gap: 5px;
      padding-right: 5px;
    }

    .voice-btn {
      width: 40px;
      height: 40px;
      padding: 10px;
    }

    .inner .btn {
      padding-inline: 12px;
    }
  }
</style>
