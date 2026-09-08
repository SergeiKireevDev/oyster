<script>
  import { onMount } from "svelte";
  import { createMcpSettingsService } from "../features/credentials/mcpSettingsService.js";
  const service = createMcpSettingsService();
  let servers = [];
  let name = "";
  let type = "http";
  let url = "";
  let command = "";
  let args = "[]";
  let secrets = "";
  let busy = true;
  let error = "";
  let message = "";

  async function request(method = "GET", body) {
    servers = await service.request(method, body);
  }
  onMount(() => { request().catch((cause) => { error = cause.message; }).finally(() => { busy = false; }); });
  async function save(event) {
    event.preventDefault();
    busy = true;
    error = message = "";
    try {
      let options;
      let argumentsList;
      try { options = JSON.parse(secrets || "{}"); argumentsList = JSON.parse(args); }
      catch { throw new Error("Arguments and headers/environment must be valid JSON"); }
      const config = type === "stdio" ? { type, command, args: argumentsList, env: options } : { type, url, headers: options };
      await request("POST", { name, config });
      name = url = command = secrets = "";
      args = "[]";
      message = "MCP server saved. It will be available when an agent starts.";
    } catch (cause) { error = cause.message; }
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
  <form onsubmit={save}>
    <label>Name<input required pattern="[a-zA-Z][a-zA-Z0-9_-]{0,39}" maxlength="40" bind:value={name} disabled={busy} placeholder="my-server" /></label>
    <label>Transport<select bind:value={type} disabled={busy} onchange={() => { secrets = ""; }}><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">Local command (stdio)</option></select></label>
    {#if type === "stdio"}
      <label>Command<input required bind:value={command} disabled={busy} placeholder="npx" /></label>
      <label>Arguments (JSON array)<input bind:value={args} disabled={busy} placeholder={'["-y", "my-mcp-server"]'} /></label>
    {:else}
      <label>Server URL<input required type="url" bind:value={url} disabled={busy} placeholder="https://example.com/mcp" /></label>
    {/if}
    <label>{type === "stdio" ? "Environment variables" : "Headers"} (optional JSON object)<input type="password" autocomplete="new-password" bind:value={secrets} disabled={busy} placeholder={type === "stdio" ? '{"API_KEY":"…"}' : '{"Authorization":"Bearer …"}'} /></label>
    <p>Use an existing name to replace its full configuration.</p>
    <button type="submit" class="btn" disabled={busy}>{busy ? "Loading…" : "Save MCP server"}</button>
  </form>
  {#if error}<p role="alert">{error}</p>{/if}
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
  [role="alert"] { color: var(--danger, #e66); }
</style>
