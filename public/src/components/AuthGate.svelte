<script>
  import oysterIcon from "../assets/oyster.svg";
  import { getAuthBrowser } from "../runtime/authBrowserContext.js";

  const authBrowser = getAuthBrowser();
  const authenticationFailed = "Authentication failed. Check the token and try again.";
  let tokenInput = "";
  let errorMessage = "";
  let connecting = false;

  async function connect() {
    if (connecting) return;
    const token = tokenInput.trim();
    if (!token) {
      errorMessage = authenticationFailed;
      return;
    }

    connecting = true;
    errorMessage = "";
    try {
      if (!await authBrowser.validateToken(token)) {
        errorMessage = authenticationFailed;
        return;
      }
      authBrowser.saveToken(token);
      authBrowser.reload();
    } catch {
      errorMessage = authenticationFailed;
    } finally {
      connecting = false;
    }
  }

  function onKeydown(event) {
    if (event.key === "Enter") connect();
  }

  function clearError() {
    errorMessage = "";
  }
</script>

<div id="gate"><div class="card">
  <div class="gate-brand"><img src={oysterIcon} alt="" /> <span>Oyster</span></div>
  <div style="color:var(--muted);font-size:13.5px">Enter the auth token printed by the server on startup.</div>
  <input
    type="password"
    id="gateInput"
    placeholder="token"
    bind:value={tokenInput}
    oninput={clearError}
    onkeydown={onKeydown}
    aria-invalid={errorMessage ? "true" : undefined}
    aria-describedby={errorMessage ? "gateError" : undefined}
    disabled={connecting}
  >
  {#if errorMessage}<div class="gate-error" id="gateError" role="alert">{errorMessage}</div>{/if}
  <button class="btn" id="gateBtn" onclick={connect} disabled={connecting}>{connecting ? "Checking…" : "Connect"}</button>
</div></div>
