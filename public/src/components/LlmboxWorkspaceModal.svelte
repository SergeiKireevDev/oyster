<script>
  import { onDestroy } from "svelte";
  import { closeModalState } from "../stores/modal.js";
  import { publishWorkspace } from "../stores/workspaces.js";
  import { getWorkspaceService } from "../runtime/workspaceServiceContext.js";
  import { createAsyncRequestGuard } from "../lib/asyncRequestGuard.js";

  const BYTES_PER_GIB = 1024 ** 3;
  const MAX_DISK_GIB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_GIB);
  const workspaceService = getWorkspaceService();

  /** @type {{ spoke?: string; environmentName?: string }} */
  let { spoke = "", environmentName = "" } = $props();

  let workspaceId = $state("");
  let workspaceName = $state("");
  /** @type {number | undefined} */
  let diskGiB = $state();
  let loading = $state(false);
  let error = $state("");
  const environmentLabel = $derived(environmentName.trim() || spoke.trim() || "Selected environment");
  const createRequests = createAsyncRequestGuard();

  /** @param {unknown} cause */
  function errorMessage(cause) {
    return cause instanceof Error && cause.message
      ? cause.message
      : "The workspace could not be created";
  }

  function clearError() {
    error = "";
  }

  /** @param {SubmitEvent} event */
  async function createWorkspace(event) {
    event.preventDefault();
    if (loading) return;

    const request = createRequests.begin();
    const id = workspaceId.trim();
    const payload = {
      id,
      name: workspaceName.trim() || id,
      spoke,
      ...(diskGiB === undefined ? {} : { diskBytes: diskGiB * BYTES_PER_GIB }),
    };

    loading = true;
    error = "";
    try {
      const workspace = await workspaceService.createLlmboxWorkspace(payload);
      if (!request.isCurrent()) return;
      publishWorkspace(workspace);
      closeModalState();
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause);
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  onDestroy(() => createRequests.invalidate());
</script>

<section class="llmbox-workspace-modal" aria-label="Create an llmbox workspace" aria-busy={loading} aria-describedby="llmboxWorkspaceIntro">
  <p id="llmboxWorkspaceIntro" class="llmbox-intro">Create a new workspace on the <strong>{environmentLabel}</strong> llmbox spoke. The spoke is the connection environment; each box created on it is a separate workspace.</p>

  <form id="llmboxWorkspaceForm" class="llmbox-form" aria-describedby={error ? "llmboxWorkspaceError" : undefined} onsubmit={createWorkspace}>
    <label class="llmbox-field">
      <span>Workspace ID <small aria-hidden="true">Required</small></span>
      <input class="llmbox-technical-input" bind:value={workspaceId} oninput={clearError} disabled={loading} required pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" maxlength="63" placeholder="refactor-auth" title="Use 1–63 lowercase letters, numbers, or hyphens" autocomplete="off" autocapitalize="none" spellcheck="false" />
      <small>1–63 lowercase letters, numbers, or hyphens.</small>
    </label>
    <label class="llmbox-field">
      <span>Display name <small>Optional</small></span>
      <input bind:value={workspaceName} oninput={clearError} disabled={loading} maxlength="500" placeholder="Workspace description" autocomplete="off" />
    </label>
    <label class="llmbox-field">
      <span>Disk size <small>GiB · Optional</small></span>
      <input class="llmbox-technical-input" bind:value={diskGiB} oninput={clearError} disabled={loading} type="number" min="1" max={MAX_DISK_GIB} step="1" placeholder="Spoke default" />
    </label>

    <div class="llmbox-summary" aria-label="Workspace destination">
      <span><small>Environment</small><strong title={environmentLabel}>{environmentLabel}</strong></span>
      <span><small>Connection</small><strong>llmbox spoke</strong></span>
    </div>

    {#if error}<p id="llmboxWorkspaceError" class="llmbox-error" role="alert" aria-atomic="true">{error}</p>{/if}
  </form>
</section>

<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel onclick={closeModalState}>Cancel</button>
  <button class="btn modal-primary-action" type="submit" form="llmboxWorkspaceForm" disabled={loading}>
    {#if loading}<span class="spin" aria-hidden="true"></span><span role="status">Creating workspace…</span>{:else}Create workspace{/if}
  </button>
</div>

<style>
  .llmbox-workspace-modal,
  .llmbox-form,
  .llmbox-field,
  .llmbox-summary span {
    display: grid;
    min-width: 0;
  }

  .llmbox-workspace-modal { gap: 14px; }

  .llmbox-intro {
    max-width: 620px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .llmbox-intro strong { color: var(--text); font-weight: 620; }

  .llmbox-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .llmbox-field {
    align-content: start;
    gap: 5px;
    color: var(--muted);
    font-size: 10.5px;
  }

  .llmbox-field:first-child { grid-column: 1 / -1; }

  .llmbox-field > span {
    color: var(--text);
    font-weight: 620;
  }

  .llmbox-field > span small {
    margin-left: 4px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 500;
  }

  .llmbox-field > small {
    font-size: 9.5px;
    line-height: 1.4;
  }

  .llmbox-field input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 38px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    outline: none;
    transition: border-color 140ms, box-shadow 140ms, background 140ms;
  }

  .llmbox-field input:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); }
  .llmbox-field input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }
  .llmbox-field input:disabled { opacity: .45; cursor: not-allowed; }
  .llmbox-technical-input { font-family: var(--mono) !important; }

  .llmbox-summary {
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
  }

  .llmbox-summary span { gap: 2px; }

  .llmbox-summary small {
    color: var(--muted);
    font-size: 8px;
    font-weight: 650;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .llmbox-summary strong {
    overflow: hidden;
    color: var(--text);
    font-size: 10.5px;
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .llmbox-error {
    grid-column: 1 / -1;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--red) 42%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--red) 8%, var(--panel));
    color: var(--red);
    font-size: 11px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .modal-primary-action .spin { border-top-color: currentColor; }

  @media (max-width: 760px) {
    .m-actions button { min-height: 40px; }
  }

  @media (max-width: 600px) {
    .llmbox-form { grid-template-columns: 1fr; }
    .llmbox-field:first-child,
    .llmbox-summary,
    .llmbox-error { grid-column: 1; }
  }

  @media (max-width: 520px) {
    .llmbox-summary { grid-template-columns: 1fr; }
    .m-actions button { flex: 1 1 132px; }
  }
</style>
