<script>
  import { onDestroy } from "svelte";
  import { closeModalState } from "../stores/modal.js";
  import { publishWorkspace } from "../stores/workspaces.js";
  import { getWorkspaceService } from "../runtime/workspaceServiceContext.js";
  import { createAsyncRequestGuard } from "../lib/asyncRequestGuard.js";

  const workspaceService = getWorkspaceService();
  export let spoke = "";
  export let environmentName = "";

  let workspaceId = "";
  let workspaceName = "";
  let diskGiB = "";
  let loading = false;
  let error = "";
  const createRequests = createAsyncRequestGuard();

  async function createWorkspace(event) {
    event.preventDefault();
    const request = createRequests.begin();
    loading = true;
    error = "";
    try {
      const payload = {
        id: workspaceId.trim(),
        name: workspaceName.trim() || workspaceId.trim(),
        spoke,
      };
      const size = Number(diskGiB);
      if (Number.isFinite(size) && size > 0) payload.diskBytes = size * 1024 * 1024 * 1024;
      const workspace = await workspaceService.createLlmboxWorkspace(payload);
      if (!request.isCurrent()) return;
      publishWorkspace(workspace);
      closeModalState();
    } catch (cause) {
      if (request.isCurrent()) error = cause.message;
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  onDestroy(() => createRequests.invalidate());
</script>

<section class="llmbox-workspace-modal" aria-label="llmbox workspace creation">
  <p class="cloud-intro">Create a new workspace on the <strong>{environmentName || spoke}</strong> llmbox spoke. The spoke is the connection environment; each box created on it is a separate workspace.</p>
  <form class="cloud-form" onsubmit={createWorkspace}>
    <label>
      <span>Workspace ID *</span>
      <input bind:value={workspaceId} required pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" maxlength="63" placeholder="refactor-auth" title="Use 1–63 lowercase letters, numbers, or hyphens" autocapitalize="none" spellcheck="false" />
    </label>
    <label>
      <span>Display name</span>
      <input bind:value={workspaceName} maxlength="500" placeholder="Optional description" />
    </label>
    <label>
      <span>Disk size (GiB)</span>
      <input bind:value={diskGiB} type="number" min="1" step="1" placeholder="Spoke default" />
    </label>
    <div class="cloud-summary wide">
      <span><small>Environment</small><strong>{environmentName || spoke}</strong></span>
      <span><small>Connection</small><strong>llmbox spoke</strong></span>
    </div>
    {#if error}<p class="cloud-error wide" role="alert">{error}</p>{/if}
    <div class="m-actions wide">
      <button class="btn" type="button" data-modal-cancel onclick={closeModalState}>Cancel</button>
      <button class="btn cloud-primary" type="submit" disabled={loading}>{loading ? "Creating…" : "Create workspace"}</button>
    </div>
  </form>
</section>
