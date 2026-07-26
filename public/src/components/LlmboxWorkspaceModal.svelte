<script>
  import { closeModalState } from "../stores/modal.js";
  import { publishWorkspace } from "../stores/workspaces.js";

  export let spoke = "";
  export let environmentName = "";

  let workspaceId = "";
  let workspaceName = "";
  let diskGiB = "";
  let loading = false;
  let error = "";

  async function createWorkspace(event) {
    event.preventDefault();
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
      const response = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Workspace creation failed (${response.status})`);
      publishWorkspace(data.workspace);
      closeModalState();
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }
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
