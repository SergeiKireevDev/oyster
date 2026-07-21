<script>
  import {
    abortComposerPrompt,
    composerInputChanged,
    composerKeydown,
    sendComposerPrompt,
  } from "../lib/legacyBridge.js";
  import { headerState } from "../stores/header.js";
</script>

<div id="composer">
  <div class="inner">
    <textarea
      id="input"
      rows="1"
      placeholder="message (type : for commands)"
      oninput={composerInputChanged}
      onkeydown={composerKeydown}
    ></textarea>
    <button class="btn" id="sendBtn" hidden={$headerState.sendHidden} onclick={sendComposerPrompt}>{$headerState.sendText}</button>
    <button class="btn stop" id="stopBtn" hidden={$headerState.stopHidden} onclick={abortComposerPrompt}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">{$headerState.stateInfo}</span>
    <span id="workdirInfo" title={$headerState.workdirTitle}>{$headerState.workdirText}</span>
    <span id="usageInfo">{$headerState.usageInfo}</span>
  </div>
</div>
