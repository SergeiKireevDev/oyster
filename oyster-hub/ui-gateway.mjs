import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Transform } from "node:stream";
import { prepareScopedWorkspaceRequest, proxyWorkspaceRequest } from "./workspace-proxy.mjs";

const DOCUMENT_ROUTE = /^\/(?:index\.html)?$|^\/s\/[\w.-]+(?:\/m\/[\w.-]+)?$/;
const SCOPE_PREFIX = "oh1.";
const SESSION_SCOPE_PREFIX = "ps1_oh1.";

function base64url(value) {
  return Buffer.from(String(value)).toString("base64url");
}

export function scopeValue(workspaceId, kind, value, { sessionKey = false } = {}) {
  if (value == null || value === "") return value ?? null;
  const prefix = sessionKey ? SESSION_SCOPE_PREFIX : SCOPE_PREFIX;
  return `${prefix}${base64url(JSON.stringify([workspaceId, kind, String(value)]))}`;
}

export function parseScopedValue(value) {
  if (typeof value !== "string") return null;
  const prefix = value.startsWith(SESSION_SCOPE_PREFIX)
    ? SESSION_SCOPE_PREFIX
    : value.startsWith(SCOPE_PREFIX) ? SCOPE_PREFIX : null;
  if (!prefix) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded.some((part) => typeof part !== "string")) return null;
    return { workspaceId: decoded[0], kind: decoded[1], value: decoded[2] };
  } catch {
    return null;
  }
}

function workspaceMeta(workspace) {
  const environmentId = workspace.environmentId || workspace.provider?.spoke || "unassigned-device";
  return {
    environmentId,
    environmentName: workspace.environmentName || environmentId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  };
}

export function scopeSession(workspace, session) {
  if (!session || typeof session !== "object") return session;
  const identity = session.sessionKey ?? session.path;
  return {
    ...session,
    ...workspaceMeta(workspace),
    id: scopeValue(workspace.id, "session-id", session.id),
    sessionKey: scopeValue(workspace.id, "session", identity, { sessionKey: true }),
    parentSessionKey: scopeValue(workspace.id, "session", session.parentSessionKey ?? session.parentSession, { sessionKey: true }),
    runnerId: scopeValue(workspace.id, "runner", session.runnerId),
  };
}

export function scopeRunner(workspace, runner) {
  if (!runner || typeof runner !== "object") return runner;
  const identity = runner.sessionKey ?? runner.sessionFile;
  return {
    ...runner,
    ...workspaceMeta(workspace),
    id: scopeValue(workspace.id, "runner", runner.id),
    sessionId: scopeValue(workspace.id, "session-id", runner.sessionId),
    sessionKey: scopeValue(workspace.id, "session", identity, { sessionKey: true }),
  };
}

export function scopeRoutine(workspace, routine) {
  if (!routine || typeof routine !== "object") return routine;
  return {
    ...routine,
    ...workspaceMeta(workspace),
    sessionId: scopeValue(workspace.id, "session-id", routine.sessionId),
  };
}

export function scopeHublot(workspace, hublot) {
  if (!hublot || typeof hublot !== "object") return hublot;
  return {
    ...hublot,
    ...workspaceMeta(workspace),
    id: scopeValue(workspace.id, "hublot", hublot.id),
    sessionId: scopeValue(workspace.id, "session-id", hublot.sessionId),
  };
}

export function scopePinnedWidgetGroup(workspace, group) {
  if (!group || typeof group !== "object") return group;
  return {
    ...group,
    ...workspaceMeta(workspace),
    id: scopeValue(workspace.id, "pinned-widget-group", group.id),
    sessionId: scopeValue(workspace.id, "session-id", group.sessionId),
  };
}

export function scopePinnedWidget(workspace, widget) {
  if (!widget || typeof widget !== "object") return widget;
  return {
    ...widget,
    ...workspaceMeta(workspace),
    id: scopeValue(workspace.id, "pinned-widget", widget.id),
    groupId: scopeValue(workspace.id, "pinned-widget-group", widget.groupId),
    hublotId: scopeValue(workspace.id, "hublot", widget.hublotId),
    sessionId: scopeValue(workspace.id, "session-id", widget.sessionId),
  };
}

function scopeSearchHit(workspace, hit) {
  if (!hit || typeof hit !== "object") return hit;
  const identity = hit.sessionKey ?? hit.sessionPath;
  return {
    ...hit,
    ...workspaceMeta(workspace),
    sessionId: scopeValue(workspace.id, "session-id", hit.sessionId),
    sessionKey: scopeValue(workspace.id, "session", identity, { sessionKey: true }),
  };
}

function scopeEvent(workspace, message, otherRunners = []) {
  if (!message || typeof message !== "object") return message;
  const data = message.data && typeof message.data === "object"
    ? {
        ...message.data,
        ...(message.data.sessionId ? { sessionId: scopeValue(workspace.id, "session-id", message.data.sessionId) } : {}),
        ...(message.data.sessionKey || message.data.sessionFile
          ? { sessionKey: scopeValue(workspace.id, "session", message.data.sessionKey ?? message.data.sessionFile, { sessionKey: true }) }
          : {}),
      }
    : message.data;
  return {
    ...message,
    ...(message.data && typeof message.data === "object" ? { data } : {}),
    ...(typeof message.runner === "string" ? { runner: scopeValue(workspace.id, "runner", message.runner) } : {}),
    ...(message.sessionId ? { sessionId: scopeValue(workspace.id, "session-id", message.sessionId) } : {}),
    ...(message.routine ? { routine: scopeRoutine(workspace, message.routine) } : {}),
    ...(message.tunnel ? { tunnel: scopeHublot(workspace, message.tunnel) } : {}),
    ...(message.widget ? { widget: scopePinnedWidget(workspace, message.widget) } : {}),
    ...(message.widgetId ? { widgetId: scopeValue(workspace.id, "pinned-widget", message.widgetId) } : {}),
    ...(message.group ? { group: scopePinnedWidgetGroup(workspace, message.group) } : {}),
    ...(message.groupId ? { groupId: scopeValue(workspace.id, "pinned-widget-group", message.groupId) } : {}),
    ...(Array.isArray(message.runners) ? { runners: [...(message.partial ? [] : otherRunners), ...message.runners.map((runner) => scopeRunner(workspace, runner))] } : {}),
  };
}

function createSseScopeTransform(workspace, initialOtherRunners = []) {
  let pending = "";
  let otherRunners = initialOtherRunners;
  let activeRunners = [];
  let finished = false;
  const transformLine = (line) => {
    if (!line.startsWith("data: ")) return line;
    try {
      const message = JSON.parse(line.slice(6));
      if (Array.isArray(message.runners)) {
        const scoped = message.runners.map((runner) => scopeRunner(workspace, runner));
        if (message.partial) {
          const merged = new Map(activeRunners.map((runner) => [runner.id, runner]));
          for (const runner of scoped) merged.set(runner.id, runner);
          activeRunners = [...merged.values()];
        } else activeRunners = scoped;
      }
      return `data: ${JSON.stringify(scopeEvent(workspace, message, otherRunners))}`;
    } catch { return line; }
  };
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      callback(null, `${lines.map(transformLine).join("\n")}${lines.length ? "\n" : ""}`);
    },
    flush(callback) {
      finished = true;
      callback(null, pending ? transformLine(pending) : "");
    },
  });
  transform.setOtherRunners = (runners) => {
    otherRunners = runners;
    if (!activeRunners.length || finished || transform.destroyed || transform.readableEnded) return false;
    return transform.push(`data: ${JSON.stringify({ type: "runners_update", _server: true, runners: [...otherRunners, ...activeRunners] })}\n\n`);
  };
  return transform;
}

async function fetchWorkspace(workspace, pathAndQuery, fetchImpl, timeoutMs) {
  const headers = { accept: "application/json" };
  if (workspace.token) headers.authorization = `Bearer ${workspace.token}`;
  try {
    const response = await (workspace.fetchImpl || fetchImpl)(`${workspace.url}/${pathAndQuery.replace(/^\/+/, "")}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(value?.error || `upstream returned ${response.status}`);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : error.message };
  }
}

function mimeType(pathname) {
  const extension = pathname.split(".").pop()?.toLowerCase();
  return ({ js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", webmanifest: "application/manifest+json; charset=utf-8", svg: "image/svg+xml", png: "image/png", json: "application/json; charset=utf-8", wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf" })[extension] || "application/octet-stream";
}

function hubDocument(html) {
  return html
    .replace("<title>Oyster</title>", "<title>Oyster Hub</title>")
    .replace('<meta name="application-name" content="Oyster">', '<meta name="application-name" content="Oyster Hub">')
    .replace('<meta name="apple-mobile-web-app-title" content="Oyster">', '<meta name="apple-mobile-web-app-title" content="Oyster Hub">');
}

export function createOysterUiGateway({ config, driver, fetchImpl, authorized, json, logger = console, onTransfer, uploadLimiter, listWorkspaces = () => driver.listWorkspaces(), uiDir = new URL("../dist/", import.meta.url) }) {
  const root = resolve(uiDir.pathname);
  const indexPath = resolve(root, "index.html");
  const manifestPath = resolve(root, "manifest.webmanifest");
  let workspaceCache = { expires: 0, promise: null };

  async function workspaces() {
    const now = Date.now();
    if (workspaceCache.promise && workspaceCache.expires > now) return workspaceCache.promise;
    const promise = Promise.resolve(listWorkspaces()).then((items) => items.filter((workspace) => workspace.url));
    workspaceCache = { expires: now + 2000, promise };
    try { return await promise; }
    catch (error) { workspaceCache = { expires: 0, promise: null }; throw error; }
  }

  function serveAsset(pathname, res) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    const target = resolve(root, decoded.replace(/^\/+/, ""));
    if ((target !== root && !target.startsWith(`${root}/`)) || !existsSync(target) || statSync(target).isDirectory()) return false;
    res.writeHead(200, { "content-type": mimeType(target), "cache-control": "no-cache" });
    createReadStream(target).pipe(res);
    return true;
  }

  async function serveHubManifest(res) {
    if (!existsSync(manifestPath)) {
      json(res, 500, { error: "Oyster PWA manifest missing; run npm run build" });
      return;
    }
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      json(res, 500, { error: `Oyster PWA manifest is invalid: ${error.message}` });
      return;
    }
    const body = JSON.stringify({
      ...manifest,
      name: "Oyster Hub",
      short_name: "Oyster Hub",
      description: "Manage Oyster environments and workspaces.",
    });
    res.writeHead(200, {
      "content-type": "application/manifest+json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-cache",
    });
    res.end(body);
  }

  function upstreamPath(url) {
    const target = new URL(url);
    target.searchParams.delete("token");
    target.searchParams.delete("workspace");
    return `${target.pathname}${target.search}`;
  }

  async function aggregate(req, res, url, key, transform) {
    const discovered = await workspaces();
    const path = upstreamPath(url);
    const results = await Promise.all(discovered.map((workspace) => fetchWorkspace(workspace, path, fetchImpl, config.timeoutMs)));
    const values = [];
    const workspaceErrors = {};
    results.forEach((result, index) => {
      const workspace = discovered[index];
      if (!result.ok) workspaceErrors[workspace.id] = result.error;
      else values.push(...(result.value?.[key] ?? []).map((item) => transform(workspace, item)));
    });
    json(res, 200, { [key]: values, ...(Object.keys(workspaceErrors).length ? { workspaceErrors } : {}) });
  }

  async function aggregateSearch(req, res, url) {
    const discovered = await workspaces();
    const results = await Promise.all(discovered.map((workspace) => fetchWorkspace(workspace, upstreamPath(url), fetchImpl, config.timeoutMs)));
    const hits = [];
    const workspaceErrors = {};
    let filesSearched = 0;
    let truncated = false;
    results.forEach((result, index) => {
      const workspace = discovered[index];
      if (!result.ok) workspaceErrors[workspace.id] = result.error;
      else {
        hits.push(...(result.value?.results ?? []).map((hit) => scopeSearchHit(workspace, hit)));
        filesSearched += Number(result.value?.filesSearched ?? 0);
        truncated ||= Boolean(result.value?.truncated);
      }
    });
    json(res, 200, { q: url.searchParams.get("q") ?? "", scope: url.searchParams.get("scope") ?? "all", results: hits, filesSearched, truncated, ...(Object.keys(workspaceErrors).length ? { workspaceErrors } : {}) });
  }

  async function proxy(req, res, url, discovered) {
    let prepared;
    try {
      prepared = await prepareScopedWorkspaceRequest(req, url, parseScopedValue);
    } catch (error) {
      return json(res, error.code === "body_too_large" ? 413 : 400, { error: error.message });
    }
    if (prepared.scopes.size > 1) return json(res, 400, { error: "request contains identities from multiple workspaces" });
    const scopedWorkspace = [...prepared.scopes][0];
    const requestedWorkspace = scopedWorkspace || String(req.headers["x-oyster-workspace"] ?? url.searchParams.get("workspace") ?? "");
    if (!requestedWorkspace) {
      return json(res, 400, { error: "workspace is required", hint: "send a scoped identity, X-Oyster-Workspace header, or workspace query parameter" });
    }
    const workspace = discovered.find((item) => item.id === requestedWorkspace);
    if (!workspace) return json(res, 404, { error: "workspace not found", workspace: requestedWorkspace });
    prepared.targetUrl.searchParams.delete("workspace");
    prepared.targetUrl.searchParams.delete("token");
    const target = `${workspace.url}/${prepared.targetUrl.pathname.replace(/^\/+/, "")}${prepared.targetUrl.search}`;
    return proxyWorkspaceRequest({
      req,
      res,
      target,
      workspace,
      prepared,
      fetchImpl: workspace.fetchImpl || fetchImpl,
      timeoutMs: config.timeoutMs,
      uploadIdleTimeoutMs: config.uploadIdleTimeoutMs,
      uploadResponseTimeoutMs: config.uploadResponseTimeoutMs,
      json,
      onTransfer,
      uploadLimiter,
      async transformJson(value, response) {
        let scoped = value;
        if (url.pathname === "/open-session" && value?.runner) scoped = { ...value, runner: scopeRunner(workspace, value.runner) };
        else if (url.pathname === "/session-by-id" && value?.session) scoped = { ...value, session: scopeSession(workspace, value.session) };
        else if (url.pathname === "/runners" && Array.isArray(value?.runners)) scoped = { ...value, runners: value.runners.map((runner) => scopeRunner(workspace, runner)) };
        else if (url.pathname === "/sessions" && Array.isArray(value?.sessions)) scoped = { ...value, sessions: value.sessions.map((session) => scopeSession(workspace, session)) };
        else if (url.pathname === "/routines") scoped = {
          ...value,
          ...(Array.isArray(value?.routines) ? { routines: value.routines.map((routine) => scopeRoutine(workspace, routine)) } : {}),
          ...(value?.routine ? { routine: scopeRoutine(workspace, value.routine) } : {}),
        };
        else if (url.pathname === "/tunnels") scoped = {
          ...value,
          ...(Array.isArray(value?.tunnels) ? { tunnels: value.tunnels.map((hublot) => scopeHublot(workspace, hublot)) } : {}),
          ...(value?.tunnel ? { tunnel: scopeHublot(workspace, value.tunnel) } : {}),
        };
        else if (["/pinned-widgets", "/pinned-widget-groups"].includes(url.pathname)) scoped = {
          ...value,
          ...(Array.isArray(value?.widgets) ? { widgets: value.widgets.map((widget) => scopePinnedWidget(workspace, widget)) } : {}),
          ...(Array.isArray(value?.groups) ? { groups: value.groups.map((group) => scopePinnedWidgetGroup(workspace, group)) } : {}),
          ...(value?.widget ? { widget: scopePinnedWidget(workspace, value.widget) } : {}),
          ...(value?.group ? { group: scopePinnedWidgetGroup(workspace, value.group) } : {}),
          ...(value?.unpinned ? { unpinned: scopeValue(workspace.id, "pinned-widget", value.unpinned) } : {}),
          ...(value?.deleted ? { deleted: scopeValue(workspace.id, "pinned-widget-group", value.deleted) } : {}),
        };
        if (!response.ok && typeof scoped?.error === "string") {
          const label = workspace.name && workspace.name !== workspace.id
            ? `workspace "${workspace.name}" (${workspace.id})`
            : `workspace ${workspace.id}`;
          scoped = { ...scoped, error: `${req.method} ${url.pathname} on ${label}: ${scoped.error}` };
        }
        return scoped;
      },
      async transformStream(source, response) {
        if (!(response.headers.get("content-type") || "").includes("text/event-stream")) return source;
        const others = discovered.filter((item) => item.id !== workspace.id);
        const transform = createSseScopeTransform(workspace);
        // Forward the selected workspace immediately. Fleet snapshots enrich
        // runner state later and must never hold the active event stream open.
        void Promise.all(others.map((item) => fetchWorkspace(item, "/runners", fetchImpl, config.timeoutMs))).then((snapshots) => {
          const otherRunners = snapshots.flatMap((snapshot, index) => snapshot.ok
            ? (snapshot.value?.runners ?? []).map((runner) => scopeRunner(others[index], runner))
            : []);
          transform.setOtherRunners(otherRunners);
        }).catch((error) => logger.warn?.("cannot enrich Hub runner stream", error));
        return source.pipe(transform);
      },
    });
  }

  return {
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/runtime-config.js") {
        const body = `globalThis.__OYSTER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({ unauthenticated: false, hub: true })});\n`;
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
        res.end(body);
        return true;
      }
      if (req.method === "GET" && url.pathname === "/authcheck") {
        const valid = authorized(req, url);
        return json(res, 200, { authorized: valid, credentials: { xAuthToken: req.headers["x-auth-token"] ? (valid ? "valid" : "present-invalid") : "absent" } }), true;
      }
      if (req.method === "GET" && url.pathname === "/manifest.webmanifest") {
        await serveHubManifest(res);
        return true;
      }
      if (req.method === "GET" && DOCUMENT_ROUTE.test(url.pathname)) {
        if (!existsSync(indexPath)) return json(res, 500, { error: "Oyster UI build missing; run npm run build" }), true;
        const body = hubDocument(await readFile(indexPath, "utf8"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-cache" });
        res.end(body);
        return true;
      }
      if (req.method === "GET" && serveAsset(url.pathname, res)) return true;
      if (url.pathname.startsWith("/api/v1") || url.pathname === "/health") return false;
      if (!authorized(req, url)) {
        res.setHeader("www-authenticate", 'Bearer realm="oyster-hub"');
        json(res, 401, { error: `unauthorized for ${req.method} ${url.pathname}` });
        return true;
      }
      const discovered = await workspaces();
      if (!discovered.length) {
        json(res, 503, { error: "no workspaces available", hint: "create an environment or workspace first" });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/runners") { await aggregate(req, res, url, "runners", scopeRunner); return true; }
      if (req.method === "GET" && url.pathname === "/sessions") { await aggregate(req, res, url, "sessions", scopeSession); return true; }
      if (req.method === "GET" && url.pathname === "/tunnels" && url.searchParams.get("all") === "1") { await aggregate(req, res, url, "tunnels", scopeHublot); return true; }
      if (req.method === "GET" && url.pathname === "/search" && (url.searchParams.get("scope") ?? "all") === "all") { await aggregateSearch(req, res, url); return true; }
      await proxy(req, res, url, discovered);
      return true;
    },
  };
}
