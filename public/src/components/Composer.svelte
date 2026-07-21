<script>
  import {
    abortComposerPrompt,
    composerInputChanged,
    composerKeydown,
    sendComposerPrompt,
  } from "../lib/legacyBridge.js";
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
    <button class="btn" id="sendBtn" onclick={sendComposerPrompt}>Send</button>
    <button class="btn stop" id="stopBtn" hidden onclick={abortComposerPrompt}>Stop</button>
  </div>
  <div id="statusbar">
    <span id="stateInfo">connecting…</span>
    <span id="workdirInfo" title="pi working directory"></span>
    <span id="usageInfo"></span>
  </div>
</div>
