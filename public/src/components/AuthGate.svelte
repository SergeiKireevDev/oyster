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

  function submit(event) {
    event.preventDefault();
    connect();
  }

  function clearError() {
    errorMessage = "";
  }
</script>

<div id="gate"><form class="card" onsubmit={submit}>
  <div class="gate-brand"><img src={oysterIcon} alt="" /> <span>Oyster</span></div>
  <label class="gate-instructions" for="gateInput">Enter the auth token printed by the server on startup.</label>
  <input
    type="password"
    id="gateInput"
    name="token"
    placeholder="token"
    bind:value={tokenInput}
    oninput={clearError}
    aria-invalid={errorMessage ? "true" : undefined}
    aria-describedby={errorMessage ? "gateError" : undefined}
    disabled={connecting}
    required
  >
  {#if errorMessage}<div class="gate-error" id="gateError" role="alert">{errorMessage}</div>{/if}
  <button class="btn" id="gateBtn" type="submit" disabled={connecting}>{connecting ? "Checking…" : "Connect"}</button>
</form></div>
