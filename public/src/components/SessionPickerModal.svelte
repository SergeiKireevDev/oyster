<script>
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    SESSION_PICKER_CANCEL_ACTION,
    SESSION_PICKER_CHOOSE_ACTION,
    SESSION_PICKER_DELETE_ACTION,
    SESSION_PICKER_LOAD_FOLDER_ACTION,
    SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    SESSION_PICKER_SEARCH_ACTION,
    SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION,
    SESSION_PICKER_SET_FOLDER_ACTION,
    SESSION_PICKER_SET_SCOPE_ACTION,
    SESSION_PICKER_STOP_ACTION,
  } from "../runtime/uiActionNames.js";
  import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";

  const uiActions = getUiActionRegistry();
  const choosePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_CHOOSE_ACTION, ...args);
  const deletePickedSession = (...args) => uiActions.invoke(SESSION_PICKER_DELETE_ACTION, ...args);
  const loadPickedSessionFolder = (...args) => uiActions.invoke(SESSION_PICKER_LOAD_FOLDER_ACTION, ...args);
  const openPickedSearchHit = (...args) => uiActions.invoke(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, ...args);
  const runSessionPickerSearch = () => uiActions.invoke(SESSION_PICKER_SEARCH_ACTION);
  const setSessionPickerExcludeTools = (...args) => uiActions.invoke(SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION, ...args);
  const setSessionPickerFolder = (...args) => uiActions.invoke(SESSION_PICKER_SET_FOLDER_ACTION, ...args);
  const setSessionPickerScope = (...args) => uiActions.invoke(SESSION_PICKER_SET_SCOPE_ACTION, ...args);
  const stopPickedSession = (...args) => uiActions.invoke(SESSION_PICKER_STOP_ACTION, ...args);
  const cancelSessionPicker = () => uiActions.invoke(SESSION_PICKER_CANCEL_ACTION);

  function fmtSessionDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(+d)) return "";
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  $: isSearching = $sessionPicker.query.trim().length >= 2;

  function folderOf(path) {
    return String(path ?? "").slice(0, String(path ?? "").lastIndexOf("/"));
  }

  function labelFor(dir) {
    return $sessionPicker.folders.find((folder) => folder.dir === dir)?.label ?? (dir === $sessionPicker.currentFolder ? $sessionPicker.currentWorkdir : dir) ?? "?";
  }

  function runnerFor(session) {
    return $sessionPicker.runners.find((runner) => runner.sessionFile === session.path) ?? { id: session.runnerId, alive: session.alive, busy: session.busy };
  }

  function isAlive(session) {
    const runner = runnerFor(session);
    return !!(runner?.alive ?? session.alive);
  }

  function isBusy(session) {
    const runner = runnerFor(session);
    return !!(runner?.busy ?? session.busy);
  }

  function forkFamilies(list) {
    const byPath = new Map(list.map((session) => [session.path, session]));
    const rootOf = (input) => {
      let session = input;
      const seen = new Set();
      while (session.parentSession && byPath.has(session.parentSession) && !seen.has(session.path)) {
        seen.add(session.path);
        session = byPath.get(session.parentSession);
      }
      return session;
    };
    const families = new Map();
    for (const session of list) {
      const root = rootOf(session);
      if (!families.has(root.path)) families.set(root.path, { session: root, forks: [] });
      if (session.path !== root.path) families.get(root.path).forks.push(session);
    }
    return [...families.values()];
  }

  function partitionFamilies(list) {
    const active = [];
    const inactive = [];
    for (const family of forkFamilies(list)) {
      const members = [family.session, ...family.forks];
      (members.some(isAlive) ? active : inactive).push(...members);
    }
    return { active, inactive };
  }

  $: currentPartition = partitionFamilies($sessionPicker.sessions);
  $: otherFolders = $sessionPicker.folders.filter((folder) => folder.dir !== $sessionPicker.currentFolder);
  $: activeOtherFolders = (() => {
    const map = new Map();
    for (const runner of $sessionPicker.runners) {
      if (!runner.alive || !runner.sessionFile) continue;
      const dir = folderOf(runner.sessionFile);
      if (dir === $sessionPicker.currentFolder) continue;
      if (!map.has(dir)) map.set(dir, new Set());
      map.get(dir).add(runner.sessionFile);
    }
    return map;
  })();

  let debounce = null;
  function focusOnMount(node) {
    queueMicrotask(() => node.focus());
  }
  function queryInput(value) {
    updateSessionPicker({
      query: value,
      ...(value.trim().length < 2 ? { searchStatus: "", searchResults: [], searching: false } : {}),
    });
    clearTimeout(debounce);
    debounce = setTimeout(() => runSessionPickerSearch(), 250);
  }
</script>

<div class="search-row">
  <input
    type="text"
    placeholder="search sessions…"
    bind:value={$sessionPicker.query}
    oninput={(event) => queryInput(event.currentTarget.value)}
    onkeydown={(event) => { if (event.key === "Enter") { clearTimeout(debounce); runSessionPickerSearch(); } }}
    use:focusOnMount
  />
  <select bind:value={$sessionPicker.scope} onchange={(event) => setSessionPickerScope(event.currentTarget.value)}>
    <option value="session">This session</option>
    <option value="folder">Folder…</option>
    <option value="all">All sessions</option>
  </select>
</div>

{#if isSearching && $sessionPicker.scope === "folder"}
  <div class="search-row">
    <select style="max-width:100%;flex:1;" bind:value={$sessionPicker.folderPath} onchange={(event) => setSessionPickerFolder(event.currentTarget.value)}>
      {#each $sessionPicker.folders as folder (folder.dir)}
        <option value={folder.dir}>{folder.label} ({folder.count})</option>
      {/each}
    </select>
  </div>
{/if}

{#if isSearching}
  <label class="search-opts">
    <input type="checkbox" bind:checked={$sessionPicker.excludeTools} onchange={(event) => setSessionPickerExcludeTools(event.currentTarget.checked)} />
    exclude tool output (search only user/ai text)
  </label>
  <div class="m-path">{$sessionPicker.searchStatus}</div>
  {#each $sessionPicker.searchResults as group (group.sessionPath)}
    <button class="m-option search-hit" title={group.sessionPath} onclick={(event) => {
      const snippet = event.target.closest?.(".s-snippet");
      const idx = snippet?.dataset?.hitIndex;
      openPickedSearchHit(group.sessionPath, group.hits[Number(idx ?? 0)] ?? group.hits[0]);
    }}>
      <div class="s-title">
        <span class="s-name">{group.first.sessionName || group.first.sessionPreview || "(unnamed session)"}</span>
        <span class="s-date">{$sessionPicker.scope === "all" ? `${group.first.folderLabel} · ` : ""}{group.hits.length} hit{group.hits.length === 1 ? "" : "s"}</span>
      </div>
      {#each group.hits.slice(0, 3) as hit, index}
        <div class="s-snippet" data-hit-index={index}>
          <span class="s-role">{hit.role === "user" ? "you" : hit.role === "assistant" ? "ai" : hit.role === "toolResult" ? "tool" : hit.kind}</span>
          {" "}{hit.snippet.before}<mark>{hit.snippet.match}</mark>{hit.snippet.after}
        </div>
      {/each}
      {#if group.hits.length > 3}
        <div class="s-snippet">…and {group.hits.length - 3} more in this session</div>
      {/if}
    </button>
  {/each}
{:else}
  {#if currentPartition.active.length || activeOtherFolders.size}
    {@render SessionSection({ title: "Active sessions" })}
    {#if currentPartition.active.length}
      {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
      {@render SessionRows({ sessions: currentPartition.active })}
    {/if}
    {#each [...activeOtherFolders.entries()] as [dir, paths] (dir)}
      {@render FolderLabel({ label: labelFor(dir) })}
      {@render SessionRows({ sessions: ($sessionPicker.otherFolderSessions[dir] ?? []).filter((session) => paths.has(session.path)) })}
    {/each}
  {/if}

  {#if currentPartition.inactive.length || otherFolders.length}
    {@render SessionSection({ title: "Inactive sessions" })}
  {/if}
  {#if currentPartition.inactive.length}
    {@render FolderLabel({ label: labelFor($sessionPicker.currentFolder) })}
    {@render SessionRows({ sessions: currentPartition.inactive })}
  {/if}
  {#if otherFolders.length}
    <details class="s-folders">
      <summary>Other folders ({otherFolders.length})</summary>
      {#each otherFolders as folder (folder.dir)}
        <details class="s-folder" ontoggle={(event) => { if (event.currentTarget.open) loadPickedSessionFolder(folder); }}>
          <summary><span class="s-ico">📁</span> {folder.label} ({folder.count})</summary>
          {#if $sessionPicker.loadingFolders[folder.dir]}
            <div class="m-path"><span class="spin"></span> loading…</div>
          {:else if $sessionPicker.otherFolderSessions[folder.dir]}
            {@const inactive = $sessionPicker.otherFolderSessions[folder.dir].filter((session) => !isAlive(session))}
            {#if inactive.length}
              {@render SessionRows({ sessions: inactive })}
            {:else}
              <div class="m-path">(no inactive sessions)</div>
            {/if}
          {/if}
        </details>
      {/each}
    </details>
  {/if}
{/if}

{#snippet sessionRow(session)}
  {@const current = session.id === $sessionPicker.currentId}
  {@const alive = isAlive(session)}
  {@const busy = isBusy(session)}
  <div class={`m-option session-row${current ? " current" : ""}`}>
    <button class="s-session-main" onclick={() => choosePickedSession(session.path)}>
      <div class="s-title">
        <span class={`s-dot${busy ? " busy" : alive ? " on" : ""}`} title={busy ? "agent working" : alive ? "process running (idle)" : "no running process"}></span>
        <span class="s-name">{session.name || session.preview || "(empty session)"}{current ? " · current" : ""}</span>
        <span class="s-date">{fmtSessionDate(session.modifiedAt)} · {session.messageCount} msgs</span>
      </div>
      {#if session.name && session.preview}
        <div class="s-preview">{session.preview}</div>
      {/if}
    </button>
    <button class="s-del s-stop" style:display={alive ? "" : "none"} title="Stop this session's process (keeps the session)" onclick={() => stopPickedSession(session)}>■</button>
    {#if !current}
      <button class="s-del" title="Delete session" onclick={() => deletePickedSession(session)}>✕</button>
    {/if}
  </div>
{/snippet}

{#snippet SessionRows({ sessions })}
  {#each forkFamilies(sessions) as family (family.session.path)}
    {@render sessionRow(family.session)}
    {#if family.forks.length}
      <details class="s-forkgroup" open={family.forks.some((fork) => fork.id === $sessionPicker.currentId)}>
        <summary>🌿 {family.forks.length} fork{family.forks.length === 1 ? "" : "s"}</summary>
        {#each family.forks as fork (fork.path)}
          {@render sessionRow(fork)}
        {/each}
      </details>
    {/if}
  {/each}
{/snippet}

{#snippet SessionSection({ title })}
  <div class="s-section">{title}</div>
{/snippet}

{#snippet FolderLabel({ label })}
  <div class="s-wd"><span class="s-ico">📁</span> {label}</div>
{/snippet}

<div class="m-actions" id="mActions">
  <button class="chip" onclick={cancelSessionPicker}>Cancel</button>
</div>
