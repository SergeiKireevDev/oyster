<script>
  import FolderIcon from "./FolderIcon.svelte";
  import { appHeader } from "../stores/appSession.js";
  import { composerUi, composerVoice } from "../stores/composer.js";
  import { headerState } from "../stores/header.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    COMPOSER_ABORT_ACTION,
    COMPOSER_INPUT_ACTION,
    COMPOSER_KEYDOWN_ACTION,
    COMPOSER_SEND_ACTION,
    COMPOSER_VOICE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const handleInput = () => uiActions.invoke(COMPOSER_INPUT_ACTION);
  const handleKeydown = (event) => uiActions.invoke(COMPOSER_KEYDOWN_ACTION, event);
  const send = () => uiActions.invoke(COMPOSER_SEND_ACTION);
  const abort = () => uiActions.invoke(COMPOSER_ABORT_ACTION);
  const toggleVoice = () => uiActions.invoke(COMPOSER_VOICE_ACTION);
</script>

<div id="composer">
  <div class="inner">
    <div class="composer-prompt" aria-hidden="true">›</div>
    <textarea
      id="input"
      rows="1"
      placeholder={$composerUi.placeholder}
      disabled={$composerUi.inputDisabled}
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>
    {#if $composerVoice.available}
      <button
        class:recording={$composerVoice.listening}
        class:speaking={$composerVoice.speaking}
        class:transcribing={$composerVoice.transcribing}
        class="voice-btn"
        id="voiceBtn"
        type="button"
        disabled={$composerVoice.transcribing}
        aria-label={$composerVoice.transcribing ? "Transcribing voice input" : $composerVoice.listening ? "Stop voice input" : "Start voice input"}
        aria-pressed={$composerVoice.listening}
        title={$composerVoice.transcribing ? $composerVoice.status : $composerVoice.listening ? "Stop listening" : $composerVoice.local ? "Record with on-device Whisper" : "Dictate message"}
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
    <button class="btn" id="sendBtn" hidden={$composerUi.sendHidden} disabled={$composerUi.sendDisabled} onclick={send}>{$composerUi.sendText}</button>
    <button class="btn stop" id="stopBtn" hidden={$composerUi.stopHidden} onclick={abort}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    {#if $composerVoice.status}<span id="voiceStatus">{$composerVoice.status}</span>{/if}
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{#if $appHeader.workdirText}<FolderIcon size={11} />{/if}{$appHeader.workdirText}</span>
  </div>
</div>
