import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * MCP endpoint served by the Oyster process itself (Streamable HTTP, stateless).
 *
 * It exposes the Oyster tools bundled as pi extensions — hublot, pinned_widget,
 * group_pinned_widgets, routine — plus a sudo-capable bash tool to MCP-capable
 * harnesses such as Claude Code. Each request identifies its runner, session,
 * and workspace through URL parameters, so nothing about the caller lives in
 * process-level configuration: `POST /mcp?runner=…&session=…&workdir=…`.
 * The tools act through the same route handlers the browser uses, dispatched
 * in-process, and the sudo password is requested from the runner's browser
 * through the brokered `POST /runner/ui-request` clarification dialog.
 */

const MAX_BASH_OUTPUT_BYTES = 200 * 1024;

function text(message, structuredContent) {
  return { content: [{ type: "text", text: message }], ...(structuredContent ? { structuredContent } : {}) };
}

function runBash(spawnImpl, command, { cwd, sudoPassword, timeoutSeconds, signal }) {
  const argv = sudoPassword === undefined
    ? ["/bin/bash", "-c", command]
    : ["sudo", "-S", "-p", "", "--", "/bin/bash", "-c", command];
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(argv[0], argv.slice(1), { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    const collect = (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      while (size > MAX_BASH_OUTPUT_BYTES && chunks.length > 1) size -= chunks.shift().length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const kill = () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
    };
    const timer = timeoutSeconds ? setTimeout(() => { timedOut = true; kill(); }, timeoutSeconds * 1000) : null;
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (error, exitCode) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) { reject(error); return; }
      const truncated = size > MAX_BASH_OUTPUT_BYTES;
      const output = Buffer.concat(chunks).toString("utf8").slice(truncated ? -MAX_BASH_OUTPUT_BYTES : 0);
      resolvePromise({ output, exitCode, timedOut, truncated });
    };
    child.on("error", (error) => finish(error, null));
    child.on("close", (code) => finish(null, code));
    child.stdin.on("error", () => {});
    child.stdin.end(sudoPassword === undefined ? undefined : `${sudoPassword}\n`);
  });
}

function describeRoutine(r) {
  const bits = [`status=${r.status}`];
  if (r.progress !== null && r.progress !== undefined) bits.push(`progress=${r.progress}%`);
  if (r.message) bits.push(`message=${JSON.stringify(r.message)}`);
  if (r.exitCode !== null && r.exitCode !== undefined) bits.push(`exit=${r.exitCode}`);
  if (r.cwd) bits.push(`cwd=${r.cwd}`);
  return `${r.name}: ${bits.join(" ")}`;
}

function progressionWarnings(script) {
  const warnings = [];
  const markers = script.match(/::progress\b/g)?.length ?? 0;
  if (markers < 3) warnings.push("fewer than three explicit progress updates");
  if (!/::progress\s+(?:0|[1-9])%?(?:\s|["'])/.test(script)) warnings.push("no explicit starting progress update");
  if (!/::progress\s+100%?(?:\s|["'])/.test(script)) warnings.push("no explicit 100% completion update");
  return warnings;
}

/**
 * Build one MCP server bound to a request context.
 *
 * @param {{ runnerId: string | null, sessionId: string | null, workdir: string }} context
 * @param {{ dispatch: Function, spawnImpl?: Function }} deps `dispatch(method, path, body, { signal })` → `{ status, data }`
 */
export function createOysterMcpServer(context, { dispatch, spawnImpl = spawn }) {
  if (typeof dispatch !== "function") throw new TypeError("MCP server dispatch must be a function");
  const { runnerId, sessionId, workdir } = context;

  async function api(method, path, body, { signal } = {}) {
    const { status, data } = await dispatch(method, path, body, { signal });
    if (status < 200 || status >= 300) {
      throw Object.assign(new Error(data?.error ?? `${method} ${path} failed (${status})`), { statusCode: status });
    }
    return data ?? {};
  }

  function requireSession() {
    if (!sessionId) throw new Error("no Oyster session (session URL parameter); this tool needs an Oyster-launched session");
    return sessionId;
  }

  /** Ask the user's browser for a masked value through Oyster's clarification dialog. */
  async function requestSecret(title, placeholder, signal) {
    if (!runnerId) throw new Error("no Oyster runner (runner URL parameter); Oyster cannot prompt for the sudo password");
    const answer = await api("POST", `/runner/ui-request?runner=${encodeURIComponent(runnerId)}`, {
      method: "input", title, placeholder, secret: true,
    }, { signal });
    return answer?.cancelled || typeof answer?.value !== "string" ? undefined : answer.value;
  }

  const server = new McpServer({ name: "oyster", version: "0.2.0" });

  server.registerTool("bash", {
    title: "Bash (sudo-capable)",
    description:
      "Run a bash command in the session workspace. Set sudo=true to run the complete command as root after " +
      "Oyster prompts the user for a masked sudo password; do not include sudo in the command. " +
      "Use the harness's native shell for ordinary commands and this tool when elevated privileges are required.",
    inputSchema: {
      command: z.string().describe("Bash command to execute (omit the sudo prefix when sudo=true)"),
      timeout: z.number().positive().optional().describe("Timeout in seconds (optional, no default timeout)"),
      sudo: z.boolean().optional().describe("Run the complete command as root after prompting for the sudo password"),
    },
  }, async ({ command, timeout, sudo }, extra) => {
    let sudoPassword;
    if (sudo === true) {
      sudoPassword = await requestSecret(`Sudo password required for: ${command}`, "Password", extra.signal);
      if (sudoPassword === undefined) throw new Error("Sudo command cancelled: no password was provided");
    }
    const run = await runBash(spawnImpl, command, { cwd: workdir, sudoPassword, timeoutSeconds: timeout, signal: extra.signal });
    const notes = [];
    if (run.timedOut) notes.push(`Command timed out after ${timeout} seconds`);
    if (run.truncated) notes.push("Output truncated to the last 200 KB");
    if (run.exitCode !== 0) notes.push(`Command exited with code ${run.exitCode ?? "unknown"}`);
    const body = [run.output.trimEnd(), ...notes].filter(Boolean).join("\n\n");
    return { ...text(body || "(no output)"), isError: run.exitCode !== 0 || run.timedOut };
  });

  server.registerTool("hublot", {
    title: "Live Interface",
    description:
      "Manage live-interface widgets (legacy name: hublots) — public web interfaces (cloudflared tunnels to local ports) for this " +
      "session. When the user asks to 'create/open a hublot', use this tool. 'open' creates a hublot — the server allocates " +
      "a free local port and returns the public URL. Normally a background agent serves `description`; the deterministic " +
      "type='git-server' bypasses the agent and serves an absolute Git worktree path through the bundled read-only Smart HTTP " +
      "server. 'close' tears one down (service process, background agent and tunnel) by id or port. 'list' shows the session's " +
      "hublots. Use hublot only when public access is required; never serve the hublot port yourself or kill cloudflared manually. " +
      "Cloudflared quick-tunnel URLs are ephemeral: after a UI server restart, open a new one for a fresh URL.",
    inputSchema: {
      action: z.enum(["open", "close", "list"]),
      description: z.string().optional().describe("For 'open': what the hublot should expose (label and, for an ordinary hublot, the brief given to the background agent)"),
      type: z.enum(["git-server"]).optional().describe("For 'open': use 'git-server' for a read-only Git worktree"),
      path: z.string().optional().describe("For type='git-server': absolute path to the Git worktree"),
      session_id: z.string().optional().describe("For 'open': bind the hublot to this session id instead of the current one"),
      id: z.string().optional().describe("For 'close': hublot id"),
      port: z.number().int().optional().describe("For 'close': local port of the hublot"),
    },
  }, async (params) => {
    if (params.action === "open") {
      if (!params.description) throw new Error("'open' requires a description");
      if (params.type === "git-server") {
        if (!params.path) throw new Error("type='git-server' requires a path");
        if (!isAbsolute(params.path)) throw new Error("type='git-server' requires an absolute path");
      } else if (params.path) {
        throw new Error("'path' is only valid with type='git-server'");
      }
      const data = await api("POST", "/tunnels", {
        label: params.description.slice(0, 200),
        brief: params.description,
        sessionId: params.session_id ?? requireSession(),
        ...(params.type === "git-server" ? { type: params.type, path: params.path } : {}),
      });
      const t = data.tunnel;
      const serviceText = params.type === "git-server"
        ? `The read-only Git Smart HTTP server is serving ${params.path}; clone, fetch, and pull are supported, while push is denied.`
        : "The background agent brought the local service up before the tunnel was opened.";
      return text(`Hublot ready: ${t.url} → http://localhost:${t.port}\n${serviceText} Do not serve the port yourself.`, t);
    }
    if (params.action === "close") {
      let id = params.id ?? null;
      if (!id) {
        if (!params.port) throw new Error("'close' requires an id or a port");
        const { tunnels } = await api("GET", "/tunnels");
        const t = tunnels.find((x) => x.port === params.port);
        if (!t) throw new Error(`no hublot on port ${params.port}`);
        id = t.id;
      }
      const data = await api("DELETE", `/tunnels?id=${encodeURIComponent(id)}`);
      return text(`Hublot closed: ${data.closed.url} (port ${data.closed.port}). Service, agent and tunnel were terminated.`, data.closed);
    }
    const { tunnels } = await api("GET", "/tunnels");
    const mine = tunnels.filter((t) => !t.sessionId || t.sessionId === sessionId);
    const lines = mine.map((t) =>
      `- id=${t.id} port=${t.port} ${t.url ?? `(waiting: ${t.status})`}${t.label ? ` — ${t.label}` : ""}${t.sessionId === sessionId ? "" : " (unbound)"}`);
    return text(lines.length ? `Hublots for this session:\n${lines.join("\n")}` : "No hublots open for this session.", { tunnels: mine });
  });

  server.registerTool("pinned_widget", {
    title: "Pinned Widget",
    description:
      "Pin, monitor, list, organize, move, or unpin artifacts in Oyster's right sidebar. A monitor stores permanent preview and " +
      "content scripts under ~/.oyster, polls its preview every 3 seconds only while visible, and runs its content script when " +
      "opened. Monitoring scripts must be complete executable scripts with shebangs; preview stdout is limited to 20 visible " +
      "characters, so design it for the thumbnail with compact symbols such as ●, ±, and ?. Use format='diff' for code diffs. " +
      "Pinned artifacts stay private and unpinning never deletes source files. Use the hublot tool only when a public live interface is required.",
    inputSchema: {
      action: z.enum(["pin", "monitor", "list", "unpin", "group", "move"]),
      path: z.string().optional().describe("For pin: artifact path, absolute or relative to the session cwd"),
      preview_script: z.string().optional().describe("For monitor: complete shebang script whose stdout is a thumbnail preview of at most 20 visible characters"),
      content_script: z.string().optional().describe("For monitor: complete shebang script whose stdout is shown in the viewer"),
      cwd: z.string().optional().describe("For monitor: script working directory; defaults to the session cwd"),
      format: z.enum(["text", "diff"]).optional().describe("For monitor: viewer format; defaults to text"),
      url: z.string().optional().describe("For pin: an explicit HTTPS link instead of a local path"),
      label: z.string().optional().describe("Optional short widget label"),
      id: z.string().optional().describe("Widget id for unpin or move"),
      group: z.string().optional().describe("For group: name of a new one-level group"),
      group_id: z.string().optional().describe("Destination group id for pin or move; omit to use the top level"),
      before_id: z.string().optional().describe("For move: place the widget before this sibling id"),
      scope: z.enum(["session", "workspace"]).optional().describe("Pin scope; defaults to the current session"),
    },
  }, async (params) => {
    const scope = params.scope ?? "session";
    if (params.action === "monitor") {
      if (!params.label?.trim()) throw new Error("'monitor' requires a label");
      if (!params.preview_script || !params.content_script) throw new Error("'monitor' requires preview_script and content_script");
      const { widget } = await api("POST", "/pinned-widgets", {
        label: params.label,
        previewScript: params.preview_script,
        contentScript: params.content_script,
        cwd: resolve(workdir, params.cwd ?? "."),
        format: params.format ?? "text",
        groupId: params.group_id,
        sessionId,
        scope,
      });
      return text(`Created monitoring widget ${widget.label} (id=${widget.id}). Its permanent scripts are stored in ${widget.scriptDirectory}.`, widget);
    }
    if (params.action === "pin") {
      if (!!params.path === !!params.url) throw new Error("'pin' requires exactly one of path or url");
      const { widget } = await api("POST", "/pinned-widgets", {
        ...(params.path ? { path: resolve(workdir, params.path) } : { url: params.url }),
        label: params.label,
        groupId: params.group_id,
        sessionId,
        scope,
      });
      return text(`Pinned ${widget.kind}: ${widget.label} (id=${widget.id}). It is private and opens in Oyster's native artifact display.`, widget);
    }
    if (params.action === "unpin") {
      if (!params.id) throw new Error("'unpin' requires id");
      await api("DELETE", `/pinned-widgets?id=${encodeURIComponent(params.id)}`);
      return text(`Unpinned widget ${params.id}. The underlying artifact was not changed.`, { id: params.id });
    }
    if (params.action === "group") {
      if (!params.group?.trim()) throw new Error("'group' requires a name");
      const { group } = await api("POST", "/pinned-widget-groups", { name: params.group, sessionId, scope });
      return text(`Created widget group ${group.name} (id=${group.id}).`, group);
    }
    if (params.action === "move") {
      if (!params.id) throw new Error("'move' requires id");
      const { widget } = await api("PATCH", "/pinned-widgets", {
        id: params.id,
        groupId: params.group_id ?? null,
        beforeId: params.before_id ?? null,
        sessionId,
      });
      return text(`Moved ${widget.label}${widget.groupId ? ` into group ${widget.groupId}` : " to the top level"}.`, widget);
    }
    const query = new URLSearchParams({ scope: "session" });
    if (sessionId) query.set("sessionId", sessionId);
    const data = await api("GET", `/pinned-widgets?${query}`);
    const all = data.widgets ?? [];
    const widgets = all.slice(0, 100);
    const groups = data.groups ?? [];
    const lines = widgets.map((widget) =>
      `- id=${widget.id} kind=${widget.kind} label=${JSON.stringify(widget.label)}${widget.groupId ? ` group=${widget.groupId}` : ""} status=${widget.availability}`);
    if (all.length > widgets.length) lines.push(`… ${all.length - widgets.length} more widgets omitted`);
    return text(lines.length ? `Pinned Widgets (${groups.length} groups):\n${lines.join("\n")}` : "No pinned widgets.", { widgets, groups, total: all.length });
  });

  server.registerTool("group_pinned_widgets", {
    title: "Group Pinned Widgets",
    description:
      "Create one Pinned Widgets group and place multiple related documentation or media files into it in one call. " +
      "Already-pinned files are moved into the new group; new files are pinned there. Source files are never changed. " +
      "When one task produces four or more documentation or media artifacts, call this once with a descriptive group name and every artifact path.",
    inputSchema: {
      group: z.string().describe("Short descriptive name for the new widget group"),
      paths: z.array(z.string()).min(2).max(100).describe("Two or more related documentation or media files to pin into the group"),
      scope: z.enum(["session", "workspace"]).optional().describe("Pin scope; defaults to the current session"),
    },
  }, async (params) => {
    const name = params.group.trim();
    if (!name) throw new Error("'group' requires a name");
    const paths = [...new Set(params.paths.map((path) => resolve(workdir, path)))];
    if (paths.length < 2) throw new Error("'paths' requires at least two distinct artifact paths");
    const scope = params.scope ?? "session";
    const query = new URLSearchParams({ scope });
    if (sessionId) query.set("sessionId", sessionId);
    const before = await api("GET", `/pinned-widgets?${query}`);
    const existingByPath = new Map(
      (before.widgets ?? []).filter((widget) => widget.path).map((widget) => [resolve(widget.path), widget]),
    );
    const { group } = await api("POST", "/pinned-widget-groups", { name, sessionId, scope });
    const changed = [];
    try {
      for (const path of paths) {
        const existing = existingByPath.get(path) ?? null;
        const data = existing
          ? await api("PATCH", "/pinned-widgets", { id: existing.id, groupId: group.id, sessionId })
          : await api("POST", "/pinned-widgets", { path, groupId: group.id, sessionId, scope });
        changed.push({ widget: data.widget, existing });
      }
    } catch (error) {
      for (const item of changed.reverse()) {
        try {
          if (item.existing) await api("PATCH", "/pinned-widgets", { id: item.widget.id, groupId: item.existing.groupId ?? null, sessionId });
          else await api("DELETE", `/pinned-widgets?id=${encodeURIComponent(item.widget.id)}`);
        } catch {}
      }
      try { await api("DELETE", `/pinned-widget-groups?id=${encodeURIComponent(group.id)}&ungroup=1`); } catch {}
      throw error;
    }
    const widgets = changed.map((item) => item.widget);
    return text(`Created widget group ${group.name} with ${widgets.length} artifacts (id=${group.id}).`, { group, widgets });
  });

  server.registerTool("routine", {
    title: "Routine",
    description:
      "Manage routines — durable runnable scripts managed by Oyster and bound to this session, with native progression " +
      "reporting in the Oyster sidebar. When the user asks to 'create a routine', use action=create with a self-contained " +
      "`script` (shebang, set -u, no interactive input) that receives one argument, `run` (do the job) or `teardown` (remove " +
      "EVERY byproduct the run created), and reports progression by printing monotonic '::progress <0-100> <message>' lines " +
      "to stdout at startup, before and after every meaningful step, periodically (at least every 30 seconds) during long " +
      "steps, and at 100% only after success. Both modes execute with cwd = this session's workdir. Actions: 'create' stores " +
      "the script and binds it to this session; 'start' runs it (prefer this over running scripts manually so the user sees " +
      "live progression); 'stop' kills it; 'teardown' removes its byproducts; 'status' reports live state, progress and recent " +
      "output; 'list' shows this session's routines; 'release' unbinds it; 'delete' removes the script itself.",
    inputSchema: {
      action: z.enum(["create", "start", "stop", "teardown", "status", "list", "release", "delete"]),
      name: z.string().optional().describe("Routine file name, e.g. 'rebuild-db.sh' (required for everything except 'list')"),
      script: z.string().optional().describe("For 'create': full script content handling the `run` and `teardown` arguments with '::progress' reporting"),
      session_id: z.string().optional().describe("For 'create'/'start': bind the routine to this session id instead of the current one"),
    },
  }, async (params) => {
    const boundSession = params.session_id ?? sessionId;
    const { action, name } = params;
    if (action === "list") {
      const { routines, dir } = await api("GET", "/routines");
      const mine = routines.filter((r) => !r.sessionId || r.sessionId === boundSession);
      const elsewhere = routines.length - mine.length;
      const lines = mine.map((r) => `- ${describeRoutine(r)}${r.sessionId ? "" : " (unbound)"}`);
      const note = elsewhere ? `\n(${elsewhere} more bound to other sessions — not usable here until released)` : "";
      return text((lines.length ? `Routines in ${dir}:\n${lines.join("\n")}` : `No routines available (store: ${dir}).`) + note, { routines: mine, boundElsewhere: elsewhere });
    }
    if (!name) throw new Error(`'${action}' requires a name`);
    if (action === "status") {
      const { routines } = await api("GET", "/routines");
      const r = routines.find((x) => x.name === name);
      if (!r) throw new Error(`no such routine: ${name}`);
      const tail = (r.log ?? []).slice(-10).join("\n");
      return text(describeRoutine(r) + (tail ? `\nrecent output:\n${tail}` : ""), r);
    }
    if (action === "create" && !params.script) throw new Error("'create' requires a script");
    const progressionNotes = action === "create" ? progressionWarnings(params.script) : [];
    const { routine } = await api("POST", "/routines", {
      name,
      action,
      sessionId: boundSession ?? requireSession(),
      ...(action === "create" ? { script: params.script } : {}),
    });
    const message = {
      create:
        `Routine "${routine.name}" registered as ${routine.path} and bound to this session (runs in ${routine.cwd ?? "the session workdir"}). ` +
        "It appears in the UI sidebar; start it with routine action=start." +
        (progressionNotes.length ? ` Progression warning: ${progressionNotes.join("; ")}.` : " Progression contract detected."),
      start: `Routine "${routine.name}" started (cwd ${routine.cwd ?? "?"}). Progression from its '::progress' lines streams live to the UI; check on it with routine action=status.`,
      stop: `Routine "${routine.name}" is being stopped (SIGTERM to its process group, SIGKILL after 4s).`,
      teardown: `Routine "${routine.name}" teardown started — its byproducts are being removed.`,
      release: `Routine "${routine.name}" released — it is no longer bound to a session.`,
      delete: `Routine "${routine.name}" deleted from the store (its byproducts were NOT touched).`,
    }[action];
    return text(message, { ...routine, progressionWarnings: progressionNotes });
  });

  return server;
}

function requestParameter(url, name) {
  const value = url.searchParams.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Routes for the in-process MCP endpoint.
 *
 * @param {{ state: object, requestContext: { json: Function }, dispatch: Function, spawnImpl?: Function }} deps
 */
export function createMcpRoutes({ state, requestContext, dispatch, spawnImpl = spawn }) {
  if (!state || typeof state !== "object") throw new TypeError("MCP routes require server state");
  if (typeof requestContext?.json !== "function") throw new TypeError("MCP routes require the request context");
  if (typeof dispatch !== "function") throw new TypeError("MCP routes require an in-process dispatch function");
  const { json } = requestContext;

  return {
    "POST /mcp": async (req, res, url) => {
      const workdir = requestParameter(url, "workdir");
      if (workdir && !isAbsolute(workdir)) {
        json(res, 400, { error: "workdir must be an absolute path" });
        return;
      }
      const context = {
        runnerId: requestParameter(url, "runner"),
        sessionId: requestParameter(url, "session"),
        workdir: resolve(workdir ?? state.currentDir ?? state.config?.PI_DIR ?? process.cwd()),
      };
      // Stateless mode: one server and transport per request, torn down with the response.
      const server = createOysterMcpServer(context, { dispatch, spawnImpl });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.once("close", () => { void server.close().catch(() => {}); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    },
  };
}
