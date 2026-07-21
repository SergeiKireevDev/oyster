<script>
  import { appHeader } from "../stores/appSession.js";
  import { composerUi, setComposerTextValue } from "../stores/composer.js";
  import { headerState } from "../stores/header.js";
  import { runComposerAction } from "../features/composer/composerActions.js";

  function handleInput(event) {
    setComposerTextValue(event.currentTarget.value);
    runComposerAction("inputChanged", event);
  }
</script>

<div id="composer">
  <div class="inner">
    <textarea
      id="input"
      rows="1"
      placeholder={$composerUi.placeholder}
      disabled={$composerUi.inputDisabled}
      oninput={handleInput}
      onkeydown={(event) => runComposerAction("keydown", event)}
    ></textarea>
    <button class="btn" id="sendBtn" hidden={$composerUi.sendHidden} disabled={$composerUi.sendDisabled} onclick={() => runComposerAction("send")}>{$composerUi.sendText}</button>
    <button class="btn stop" id="stopBtn" hidden={$composerUi.stopHidden} onclick={() => runComposerAction("abort")}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{$appHeader.workdirText}</span>
    <span id="usageInfo">{$headerState.usageInfo}</span>
  </div>
</div>
