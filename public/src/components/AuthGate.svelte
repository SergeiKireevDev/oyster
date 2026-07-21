<script>
  import { getAuthBrowser } from "../runtime/authBrowserContext.js";

  const authBrowser = getAuthBrowser();
  let tokenInput = "";

  function connect() {
    const token = tokenInput.trim();
    if (!token) return;
    authBrowser.saveToken(token);
    authBrowser.reload();
  }

  function onKeydown(event) {
    if (event.key === "Enter") connect();
  }
</script>

<div id="gate"><div class="card">
  <div style="font-weight:600;font-size:17px">pi-lot</div>
  <div style="color:var(--muted);font-size:13.5px">Enter the auth token printed by the server on startup.</div>
  <input type="password" id="gateInput" placeholder="token" bind:value={tokenInput} onkeydown={onKeydown}>
  <button class="btn" id="gateBtn" onclick={connect}>Connect</button>
</div></div>
