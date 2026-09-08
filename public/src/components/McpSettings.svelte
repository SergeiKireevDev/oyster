<script>
  import { onMount, tick } from "svelte";
  import { createMcpSettingsService, mcpServerInput } from "../features/credentials/mcpSettingsService.js";
  const service = createMcpSettingsService();
  let servers = [];
  let name = "";
  let type = "http";
  let url = "";
  let command = "";
  let args = "[]";
  let secrets = "";
  let nextHeaderId = 0;
  let headers = [newHeader()];
  let busy = true;
  let error = "";
  let message = "";

  function newHeader() { return { id: nextHeaderId++, name: "", value: "" }; }
  function addHeader() { headers = [...headers, newHeader()]; }
  function removeHeader(id) { headers = headers.filter((header) => header.id !== id); }
  function changeTransport() { secrets = ""; headers = [newHeader()]; error = message = ""; }
  function focusError(node) { void tick().then(() => { if (node.isConnected) node.focus(); }); }

  async function request(method = "GET", body) {
    servers = await service.request(method, body);
  }
  onMount(() => { request().catch((cause) => { error = cause.message; }).finally(() => { busy = false; }); });
  async function save(event) {
    event.preventDefault();
    busy = true;
    error = message = "";
    await tick();
    try {
      const input = mcpServerInput({ name, type, url, command, args, secrets, headers });
      await request("POST", input);
      headers = [newHeader()];
      name = url = command = secrets = "";
      args = "[]";
      message = "MCP server saved. It will be available when an agent starts.";
    } catch (cause) {
      error = cause.message;
    }
    finally { busy = false; }
  }
  async function remove(name) {
    busy = true;
    error = message = "";
    try { await request("DELETE", { name }); message = "MCP server removed from future agent starts."; }
    catch (cause) { error = cause.message; }
    finally { busy = false; }
  }
</script>

<section class="mcp-settings" aria-label="MCP servers" aria-busy={busy}>
  <h3>MCP servers</h3>
  <p>Add tools to every new agent session, across all harnesses. Changes apply when an agent starts. Saved connection details are kept private.</p>
  {#each servers as server (server.name)}
    <div class="mcp-row"><span><strong>{server.name}</strong> · {server.type}</span><button type="button" class="chip" disabled={busy} onclick={() => remove(server.name)} aria-label={`Remove MCP server ${server.name}`}>Remove</button></div>
  {:else}
    {#if !busy}<p>No MCP servers added.</p>{/if}
  {/each}
  <form novalidate onsubmit={save}>
    <label>Name<input required maxlength="40" bind:value={name} disabled={busy} placeholder="my-server" /></label>
    <label>Transport<select bind:value={type} disabled={busy} onchange={changeTransport}><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">Local command (stdio)</option></select></label>
    {#if type === "stdio"}
      <label>Command<input required bind:value={command} disabled={busy} placeholder="npx" /></label>
      <label>Arguments (JSON array)<input bind:value={args} disabled={busy} placeholder={'["-y", "my-mcp-server"]'} /></label>
    {:else}
      <label>Server URL<input required type="url" bind:value={url} disabled={busy} placeholder="https://example.com/mcp" /></label>
    {/if}
    {#if type === "stdio"}
      <label>Environment variables (optional JSON object)<input type="password" autocomplete="new-password" bind:value={secrets} disabled={busy} placeholder={'{"API_KEY":"…"}'} /></label>
    {:else}
      <fieldset disabled={busy}>
        <legend>Headers (optional)</legend>
        {#each headers as header, index (header.id)}
          <div class="header-row">
            <label>Header name<input bind:value={header.name} autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Authorization" /></label>
            <label>Header value<input type="password" autocomplete="new-password" bind:value={header.value} placeholder="Bearer …" /></label>
            <button type="button" class="chip" aria-label={`Remove header ${index + 1}`} onclick={() => removeHeader(header.id)}>Remove</button>
          </div>
        {/each}
        <button type="button" class="chip" onclick={addHeader}>Add header</button>
      </fieldset>
    {/if}
    <p>Use an existing name to replace its full configuration.</p>
    {#if error}
      <p class="mcp-error" role="alert" tabindex="-1"
        use:focusError
      >{error}</p>
    {/if}
    <button type="submit" class="btn" disabled={busy}>{busy ? "Loading…" : "Save MCP server"}</button>
  </form>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .mcp-settings { border-top: 1px solid var(--border); margin-top: 20px; padding-top: 16px; }
  h3 { margin: 0 0 8px; font-size: 14px; }
  p { font-size: 12px; color: var(--muted); line-height: 1.5; }
  .mcp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; overflow-wrap: anywhere; }
  form { display: grid; gap: 10px; margin-top: 16px; }
  label { display: grid; gap: 5px; font-size: 12px; }
  input, select { width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
  button { width: fit-content; }
  fieldset { min-width: 0; margin: 0; padding: 10px; border: 1px solid var(--border); border-radius: 6px; }
  legend { font-size: 12px; }
  .header-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 8px; margin-bottom: 10px; }
  .mcp-error { margin: 0; }
  @media (max-width: 600px) { .header-row { grid-template-columns: minmax(0, 1fr); } }
  [role="alert"] { color: var(--danger, #e66); }
</style>
