<script>
  import { hublotManager, updateHublotManager } from "../stores/hublotManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    FILE_EXPLORER_OPEN_ACTION,
    HUBLOT_CREATE_ACTION,
    HUBLOT_OPEN_COMMAND_PALETTE_ACTION,
    HUBLOT_REMOVE_ACTION,
    HUBLOT_TOGGLE_SCOPE_ACTION,
  } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const openManagedFileExplorer = () => uiActions.invoke(FILE_EXPLORER_OPEN_ACTION);
  const closeManagedHublot = (id) => uiActions.invoke(HUBLOT_REMOVE_ACTION, id);
  const createManagedHublot = (description) => uiActions.invoke(HUBLOT_CREATE_ACTION, description);
  const toggleManagedHublotScope = () => uiActions.invoke(HUBLOT_TOGGLE_SCOPE_ACTION);
  const commandPalette = (node) => uiActions.invoke(HUBLOT_OPEN_COMMAND_PALETTE_ACTION, node);
</script>

<div class="m-option" style="align-items:center;">
  <button class="btn" style="padding:6px 10px;" onclick={openManagedFileExplorer}>📁 File explorer</button>
  <span class="m-path" style="margin:0;">browse, download, edit, or upload workspace files</span>
</div>

{#if $hublotManager.loading}
  <div class="m-path"><span class="spin"></span> loading hublots…</div>
{:else if !$hublotManager.tunnels.length}
  <div class="m-path">
    {$hublotManager.scopeAll
      ? "(no active hublots)"
      : $hublotManager.total
        ? `(none for this session — ${$hublotManager.total} in other sessions)`
        : "(no active hublots)"}
  </div>
{:else}
  <div class="hublot-grid">
    {#each $hublotManager.tunnels as tunnel (tunnel.id)}
      <div class="hublot-block">
        <div class="preview">
          <iframe src={tunnel.url} loading="lazy" sandbox="allow-scripts allow-same-origin" title={tunnel.label ?? tunnel.url}></iframe>
          <button
            type="button"
            class="hit"
            title={`open ${tunnel.url}`}
            onclick={() => browserActions.openExternal(tunnel.url)}
          ></button>
        </div>
        <div class="cap">
          <span class="lbl" title={`${tunnel.url}\n${tunnel.label ?? ""}`}>
            {[
              `:${tunnel.port}`,
              tunnel.label,
              $hublotManager.scopeAll && tunnel.sessionId
                ? (tunnel.sessionId === $hublotManager.currentSessionId ? "this session" : `session ${String(tunnel.sessionId).slice(0, 8)}`)
                : null,
            ].filter(Boolean).join(" · ")}
          </span>
          <button
            class="x"
            title="close this hublot"
            onclick={() => closeManagedHublot(tunnel.id)}
          >✕</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;border-top:1px solid var(--border,#333);padding-top:12px;">
  <div style="font-weight:600;font-size:13.5px;">New hublot</div>
  <div style="display:flex;gap:6px;align-items:flex-start;">
    <textarea
      use:commandPalette
      rows="3"
      placeholder="What should the agent expose through this hublot? (e.g. “the vite dev server for the dashboard, with hot reload”)"
      style="resize:vertical;flex:1;min-width:0;"
      value={$hublotManager.desc}
      oninput={(event) => updateHublotManager({ desc: event.currentTarget.value })}
    ></textarea>
  </div>
  <button class="btn" disabled={$hublotManager.creating} onclick={() => createManagedHublot($hublotManager.desc)}>
    {$hublotManager.creating ? "Opening…" : "Open hublot"}
  </button>
</div>
<div class="m-actions" id="mActions">
  <button class="chip" title="toggle between this session's tunnels and all of them" onclick={toggleManagedHublotScope}>{$hublotManager.scopeAll ? "This session only" : "All sessions"}</button>
  <button class="chip" onclick={closeModalState}>Close</button>
</div>
