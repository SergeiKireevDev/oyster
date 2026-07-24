<script>
  import FolderIcon from "./FolderIcon.svelte";
  import { hublots, hublotsLoading } from "../stores/hublots.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { FILE_EXPLORER_OPEN_ACTION, HUBLOT_REMOVE_ACTION } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const openFileExplorer = () => uiActions.invoke(FILE_EXPLORER_OPEN_ACTION);
  const closeHublot = (id) => uiActions.invoke(HUBLOT_REMOVE_ACTION, id);
</script>

<div id="hublotList" style="display:contents">
  {#if $hublotsLoading}
    <div class="sidebar-loading"><span class="spin"></span> loading hublots…</div>
  {:else}
    <button type="button" class="hublot-block" onclick={openFileExplorer}>
      <span class="preview builtin" title="browse server files, download or edit any of them"><FolderIcon size={46} class="folder-icon-hero" /></span>
      <span class="cap">
        <span class="lbl" title="browse server files, download or edit any of them">file explorer · built-in</span>
      </span>
    </button>

    {#each $hublots as hublot (hublot.id)}
      <div class="hublot-block">
        {#if hublot.status === "opening" || hublot.status === "recovering" || !hublot.url}
          <div class="preview pending" aria-label="Waiting for Cloudflare">
            <span class="spin"></span>
            <span>Waiting for Cloudflare…</span>
          </div>
        {:else}
          <div class="preview">
            <iframe src={hublot.url} loading="lazy" sandbox="allow-scripts allow-same-origin" title={hublot.label || hublot.url}></iframe>
            <button type="button" class="hit" title={`open ${hublot.url}`} onclick={() => browserActions.openExternal(hublot.url)}></button>
          </div>
        {/if}
        <div class="cap">
          <span class="lbl" title={`${hublot.url ?? "waiting"} → :${hublot.port}\n${hublot.label ?? ""}`}>{hublot.label || (hublot.url ? new URL(hublot.url).hostname : `:${hublot.port}`)}</span>
          <button class="x" title="close this tunnel" onclick={() => closeHublot(hublot.id)}>✕</button>
        </div>
      </div>
    {/each}
  {/if}
</div>
