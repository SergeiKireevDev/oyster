<script>
  import { appHeader } from "../stores/appSession.js";
  import { composerUi, setComposerTextValue } from "../stores/composer.js";
  import { headerState } from "../stores/header.js";

  function runComposerAction(action, sourceEvent = null) {
    document.dispatchEvent(new CustomEvent("pi:composer", { detail: { action, sourceEvent } }));
  }

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
      placeholder="message (type : for commands)"
      oninput={handleInput}
      onkeydown={(event) => runComposerAction("keydown", event)}
    ></textarea>
    <button class="btn" id="sendBtn" hidden={$composerUi.sendHidden} onclick={() => runComposerAction("send")}>{$composerUi.sendText}</button>
    <button class="btn stop" id="stopBtn" hidden={$composerUi.stopHidden} onclick={() => runComposerAction("abort")}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    <span id="workdirInfo" title={$appHeader.workdirTitle}>{$appHeader.workdirText}</span>
    <span id="usageInfo">{$headerState.usageInfo}</span>
  </div>
</div>
