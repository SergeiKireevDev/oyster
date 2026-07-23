import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);
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
    ...(Array.isArray(message.runners) ? { runners: [...otherRunners, ...message.runners.map((runner) => scopeRunner(workspace, runner))] } : {}),
  };
}

function createSseScopeTransform(workspace, otherRunners = []) {
  let pending = "";
  const transformLine = (line) => {
    if (!line.startsWith("data: ")) return line;
    try { return `data: ${JSON.stringify(scopeEvent(workspace, JSON.parse(line.slice(6)), otherRunners))}`; }
    catch { return line; }
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      callback(null, `${lines.map(transformLine).join("\n")}${lines.length ? "\n" : ""}`);
    },
    flush(callback) { callback(null, pending ? transformLine(pending) : ""); },
  });
}

function upstreamHeaders(req, workspace) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())
      && !["authorization", "x-api-key", "x-auth-token", "x-oyster-workspace", "cookie", "content-length"].includes(name.toLowerCase())
      && value != null) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  if (workspace.token) headers.set("authorization", `Bearer ${workspace.token}`);
  return headers;
}

async function readBody(req) {
  if (["GET", "HEAD"].includes(req.method)) return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function decodeDeep(value, scopes) {
  if (typeof value === "string") {
    const scoped = parseScopedValue(value);
    if (!scoped) return value;
    scopes.add(scoped.workspaceId);
    return scoped.value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeDeep(item, scopes));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeDeep(item, scopes)]));
  }
  return value;
}

function prepareRequest(req, url, body) {
  const targetUrl = new URL(url);
  const scopes = new Set();
  for (const [name, value] of [...targetUrl.searchParams.entries()]) {
    const scoped = parseScopedValue(value);
    if (!scoped) continue;
    scopes.add(scoped.workspaceId);
    targetUrl.searchParams.set(name, scoped.value);
  }
  let targetBody = body;
  const contentType = String(req.headers["content-type"] ?? "");
  if (body?.length && contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      targetBody = Buffer.from(JSON.stringify(decodeDeep(parsed, scopes)));
    } catch {}
  }
  return { targetUrl, targetBody, scopes };
}

function publicHeaders(response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") headers[name] = value;
  });
  return headers;
}

async function fetchWorkspace(workspace, pathAndQuery, fetchImpl, timeoutMs) {
  const headers = { accept: "application/json" };
  if (workspace.token) headers.authorization = `Bearer ${workspace.token}`;
  try {
    const response = await fetchImpl(`${workspace.url}/${pathAndQuery.replace(/^\/+/, "")}`, {
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
  return ({ js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", svg: "image/svg+xml", json: "application/json; charset=utf-8", wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf" })[extension] || "application/octet-stream";
}

export function createOysterUiGateway({ config, driver, fetchImpl, authorized, json, logger = console, uiDir = new URL("../dist/", import.meta.url) }) {
  const root = resolve(uiDir.pathname);
  const indexPath = resolve(root, "index.html");
  let workspaceCache = { expires: 0, promise: null };

  async function workspaces() {
    const now = Date.now();
    if (workspaceCache.promise && workspaceCache.expires > now) return workspaceCache.promise;
    const promise = driver.listWorkspaces().then((items) => items.filter((workspace) => workspace.url));
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
    const body = await readBody(req);
    const prepared = prepareRequest(req, url, body);
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
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(new Error(`workspace timed out after ${config.timeoutMs}ms`)), config.timeoutMs);
    try {
      const response = await fetchImpl(target, {
        method: req.method,
        headers: upstreamHeaders(req, workspace),
        body: prepared.targetBody,
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timer); timer = null;
      res.once("close", () => controller.abort());
      const headers = publicHeaders(response);
      headers["x-oyster-workspace"] = workspace.id;
      const contentType = response.headers.get("content-type") || "";
      const scopeJson = async () => {
        const value = await response.json().catch(() => null);
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
        if (!response.ok && typeof scoped?.error === "string") {
          const label = workspace.name && workspace.name !== workspace.id
            ? `workspace "${workspace.name}" (${workspace.id})`
            : `workspace ${workspace.id}`;
          scoped = { ...scoped, error: `${req.method} ${url.pathname} on ${label}: ${scoped.error}` };
        }
        const output = Buffer.from(JSON.stringify(scoped));
        delete headers["content-length"];
        headers["content-length"] = String(output.length);
        res.writeHead(response.status, headers);
        res.end(output);
      };
      if (contentType.includes("application/json")) return scopeJson();
      res.writeHead(response.status, headers);
      if (!response.body || req.method === "HEAD") return res.end();
      if (contentType.includes("text/event-stream")) {
        const others = discovered.filter((item) => item.id !== workspace.id);
        const snapshots = await Promise.all(others.map((item) => fetchWorkspace(item, "/runners", fetchImpl, config.timeoutMs)));
        const otherRunners = snapshots.flatMap((snapshot, index) => snapshot.ok
          ? (snapshot.value?.runners ?? []).map((runner) => scopeRunner(others[index], runner))
          : []);
        return pipeline(Readable.fromWeb(response.body), createSseScopeTransform(workspace, otherRunners), res);
      }
      return pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!res.headersSent) json(res, 502, { error: "workspace request failed", workspace: workspace.id, detail: error.message });
      else res.destroy(error);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
      if (req.method === "GET" && DOCUMENT_ROUTE.test(url.pathname)) {
        if (!existsSync(indexPath)) return json(res, 500, { error: "Oyster UI build missing; run npm run build" }), true;
        const body = (await readFile(indexPath, "utf8")).replace("<title>Oyster</title>", "<title>Oyster Hub</title>");
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
