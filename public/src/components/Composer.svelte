<script>
  import FolderIcon from "./FolderIcon.svelte";
  import { appHeader } from "../stores/appSession.js";
  import { composerUi } from "../stores/composer.js";
  import { headerState } from "../stores/header.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    COMPOSER_ABORT_ACTION,
    COMPOSER_INPUT_ACTION,
    COMPOSER_KEYDOWN_ACTION,
    COMPOSER_SEND_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const handleInput = () => uiActions.invoke(COMPOSER_INPUT_ACTION);
  const handleKeydown = (event) => uiActions.invoke(COMPOSER_KEYDOWN_ACTION, event);
  const send = () => uiActions.invoke(COMPOSER_SEND_ACTION);
  const abort = () => uiActions.invoke(COMPOSER_ABORT_ACTION);
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
    <button class="btn" id="sendBtn" hidden={$composerUi.sendHidden} disabled={$composerUi.sendDisabled} onclick={send}>{$composerUi.sendText}</button>
    <button class="btn stop" id="stopBtn" hidden={$composerUi.stopHidden} onclick={abort}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{#if $appHeader.workdirText}<FolderIcon size={11} />{/if}{$appHeader.workdirText}</span>
  </div>
</div>
