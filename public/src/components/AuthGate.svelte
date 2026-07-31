<script>
  import oysterIcon from "../assets/oyster.svg";
  import { getAuthBrowser } from "../runtime/authBrowserContext.js";

  const AUTHENTICATION_FAILED = "Authentication failed. Check the token and try again.";
  const authBrowser = getAuthBrowser();

  let tokenInput = $state("");
  let errorMessage = $state("");
  let connecting = $state(false);
  let inputDescription = $derived(errorMessage ? "gateInstructions gateError" : "gateInstructions");

  async function connect() {
    if (connecting) return;

    const token = tokenInput.trim();
    if (!token) {
      errorMessage = AUTHENTICATION_FAILED;
      return;
    }

    connecting = true;
    errorMessage = "";
    try {
      if (!await authBrowser.validateToken(token)) {
        errorMessage = AUTHENTICATION_FAILED;
        return;
      }

      authBrowser.saveToken(token);
      tokenInput = "";
      authBrowser.reload();
    } catch {
      errorMessage = AUTHENTICATION_FAILED;
    } finally {
      connecting = false;
    }
  }

  /** @param {SubmitEvent} event */
  function submit(event) {
    event.preventDefault();
    void connect();
  }

  function clearError() {
    if (errorMessage) errorMessage = "";
  }
</script>

<div
  id="gate"
  role="dialog"
  aria-modal="true"
  aria-labelledby="gateTitle"
  aria-describedby="gateInstructions"
>
  <form class="card" onsubmit={submit} aria-busy={connecting}>
    <div class="gate-brand" id="gateTitle">
      <img src={oysterIcon} alt="">
      <span>Oyster</span>
    </div>
    <label for="gateInput">Authentication token</label>
    <div class="gate-instructions" id="gateInstructions">
      Enter the auth token printed by the server on startup.
    </div>
    <input
      type="password"
      id="gateInput"
      name="token"
      autocomplete="current-password"
      autocapitalize="none"
      spellcheck="false"
      bind:value={tokenInput}
      oninput={clearError}
      aria-invalid={errorMessage ? "true" : undefined}
      aria-describedby={inputDescription}
      readonly={connecting}
      required
    >
    {#if errorMessage}
      <div class="gate-error" id="gateError" role="alert" aria-atomic="true">{errorMessage}</div>
    {/if}
    <button class="btn" id="gateBtn" type="submit" disabled={connecting}>
      {connecting ? "Checking…" : "Connect"}
    </button>
  </form>
</div>
