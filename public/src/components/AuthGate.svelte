<script>
  let tokenInput = "";

  function connect() {
    const token = tokenInput.trim();
    if (!token) return;
    localStorage.setItem("pi_ui_token", token);
    location.reload();
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
