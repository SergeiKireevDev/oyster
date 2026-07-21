<script>
  import {
    createManagedHublot,
    openManagedFileExplorer,
    setupManagedCommandPalette,
  } from "../lib/legacyBridge.js";
  import { removeHublot } from "../lib/hublotActions.js";
  import { hublotManager, updateHublotManager } from "../stores/hublotManager.js";
  import { addToast } from "../stores/toasts.js";

  async function closeManagedHublot(id) {
    try {
      await removeHublot(fetch, id);
      updateHublotManager({ tunnels: $hublotManager.tunnels.filter((tunnel) => tunnel.id !== id) });
    } catch (error) {
      addToast(`close hublot failed: ${error.message}`, "error");
    }
  }

  function commandPalette(node) {
    setupManagedCommandPalette(node);
  }

  function keyActivate(event, fn) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fn();
    }
  }
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
          <div
            class="hit"
            title={`open ${tunnel.url}`}
            role="button"
            tabindex="0"
            onclick={() => window.open(tunnel.url, "_blank", "noopener")}
            onkeydown={(event) => keyActivate(event, () => window.open(tunnel.url, "_blank", "noopener"))}
          ></div>
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
          <span
            class="x"
            title="close this hublot"
            role="button"
            tabindex="0"
            onclick={() => closeManagedHublot(tunnel.id)}
            onkeydown={(event) => keyActivate(event, () => closeManagedHublot(tunnel.id))}
          >✕</span>
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
