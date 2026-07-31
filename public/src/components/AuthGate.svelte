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
    <div class="gate-heading">
      <div class="gate-brand" id="gateTitle">
        <img src={oysterIcon} alt="">
        <span>Oyster</span>
      </div>
      <p>Connect to your workspace</p>
    </div>
    <label class="gate-label" for="gateInput">Authentication token</label>
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
      <div class="gate-error" id="gateError" role="alert" aria-atomic="true">
        <span class="gate-error-mark" aria-hidden="true">!</span>
        <span>{errorMessage}</span>
      </div>
    {/if}
    <button class="btn gate-submit" id="gateBtn" type="submit" disabled={connecting}>
      {#if connecting}<span class="gate-spinner" aria-hidden="true"></span>{/if}
      <span>{connecting ? "Checking…" : "Connect"}</span>
    </button>
  </form>
</div>

<style>
  #gate {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: none;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: clamp(20px, 5vw, 48px);
    background:
      radial-gradient(circle at 50% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 38%),
      var(--bg);
  }

  .card {
    display: flex;
    width: min(100%, 390px);
    min-width: 0;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 26px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--panel) 96%, transparent);
    box-shadow: var(--shadow-lg), inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
  }

  .gate-heading { display: grid; gap: 4px; margin-bottom: 4px; }

  .gate-heading p {
    margin: 0 0 0 46px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .gate-brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    font-size: 18px;
    font-weight: 680;
    letter-spacing: -.02em;
  }

  .gate-brand img {
    width: 36px;
    height: 36px;
    flex: none;
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 42%, transparent));
  }

  .gate-label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 620;
  }

  .gate-instructions {
    margin-top: -7px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.45;
  }

  input {
    width: 100%;
    min-width: 0;
    min-height: 40px;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel-2);
    color: var(--text);
    font: 12.5px var(--mono);
    transition: border-color .15s, box-shadow .15s, background .15s;
  }

  input:hover:not(:read-only) { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
  input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
  input:read-only { cursor: wait; opacity: .72; }
  input[aria-invalid="true"] { border-color: var(--red); box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 14%, transparent); }

  .gate-error {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    color: var(--red);
    font-size: 12px;
    line-height: 1.4;
  }

  .gate-error-mark {
    display: grid;
    width: 16px;
    height: 16px;
    flex: none;
    place-items: center;
    border: 1px solid currentColor;
    border-radius: 50%;
    font: 750 10px/1 var(--mono);
  }

  .gate-submit { display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 8px; margin-top: 2px; }

  .gate-spinner {
    width: 13px;
    height: 13px;
    box-sizing: border-box;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: gate-spin .8s linear infinite;
  }

  @keyframes gate-spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    #gate {
      align-items: flex-start;
      padding: max(20px, env(safe-area-inset-top)) 14px max(20px, env(safe-area-inset-bottom));
    }

    .card { margin-block: auto; padding: 22px 18px; border-radius: 14px; }
    input, .gate-submit { min-height: 42px; }
  }

  @media (max-width: 520px) {
    #gate { padding-inline: 10px; }
    .card { padding-inline: 16px; }
  }
</style>
