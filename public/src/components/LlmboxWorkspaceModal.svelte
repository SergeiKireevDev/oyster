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

<section class="llmbox-workspace-modal" aria-label="Create an llmbox workspace" aria-busy={loading}>
  <p class="cloud-intro">Create a new workspace on the <strong>{environmentLabel}</strong> llmbox spoke. The spoke is the connection environment; each box created on it is a separate workspace.</p>
  <form class="cloud-form" aria-describedby={error ? "llmboxWorkspaceError" : undefined} onsubmit={createWorkspace}>
    <label>
      <span>Workspace ID *</span>
      <input bind:value={workspaceId} oninput={clearError} required pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" maxlength="63" placeholder="refactor-auth" title="Use 1–63 lowercase letters, numbers, or hyphens" autocomplete="off" autocapitalize="none" spellcheck="false" />
    </label>
    <label>
      <span>Display name</span>
      <input bind:value={workspaceName} oninput={clearError} maxlength="500" placeholder="Optional description" autocomplete="off" />
    </label>
    <label>
      <span>Disk size (GiB)</span>
      <input bind:value={diskGiB} oninput={clearError} type="number" min="1" max={MAX_DISK_GIB} step="1" placeholder="Spoke default" />
    </label>
    <div class="cloud-summary wide">
      <span><small>Environment</small><strong>{environmentLabel}</strong></span>
      <span><small>Connection</small><strong>llmbox spoke</strong></span>
    </div>
    {#if error}<p id="llmboxWorkspaceError" class="cloud-error wide" role="alert" aria-atomic="true">{error}</p>{/if}
    <div class="m-actions wide">
      <button class="btn" type="button" data-modal-cancel onclick={closeModalState}>Cancel</button>
      <button class="btn cloud-primary" type="submit" disabled={loading}>{loading ? "Creating…" : "Create workspace"}</button>
    </div>
  </form>
</section>
