<script>
  import { removeHublot } from "../lib/hublotActions.js";
  import { hublots, hublotsLoading } from "../stores/hublots.js";
  import { addToast } from "../stores/toasts.js";
  import { getBrowserActions } from "../runtime/browserActionsContext.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { FILE_EXPLORER_OPEN_ACTION } from "../runtime/uiActionNames.js";

  const browserActions = getBrowserActions();
  const uiActions = getUiActionRegistry();
  const openFileExplorer = () => uiActions.invoke(FILE_EXPLORER_OPEN_ACTION);

  async function closeHublot(id) {
    try {
      await removeHublot(fetch, id);
      hublots.update((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      addToast(`close hublot failed: ${error.message}`, "error");
    }
  }
</script>

<div id="hublotList" style="display:contents">
  {#if $hublotsLoading}
    <div class="sidebar-loading"><span class="spin"></span> loading hublots…</div>
  {:else}
    <div class="hublot-block" onclick={() => openFileExplorer()} role="button" tabindex="0" onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFileExplorer(); } }}>
      <div class="preview builtin" title="browse server files, download or edit any of them">📁</div>
      <div class="cap">
        <span class="lbl" title="browse server files, download or edit any of them">file explorer · built-in</span>
      </div>
    </div>

    {#each $hublots as hublot (hublot.id)}
      <div class="hublot-block">
        <div class="preview">
          <iframe src={hublot.url} loading="lazy" sandbox="allow-scripts allow-same-origin" title={hublot.label || hublot.url}></iframe>
          <div class="hit" title={`open ${hublot.url}`} role="button" tabindex="0" onclick={() => browserActions.openExternal(hublot.url)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browserActions.openExternal(hublot.url); } }}></div>
        </div>
        <div class="cap">
          <span class="lbl" title={`${hublot.url} → :${hublot.port}\n${hublot.label ?? ""}`}>{hublot.label || new URL(hublot.url).hostname}</span>
          <button class="x" title="close this tunnel" onclick={() => closeHublot(hublot.id)}>✕</button>
        </div>
      </div>
    {/each}
  {/if}
</div>
