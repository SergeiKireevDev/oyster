import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile } from "node:fs/promises";
import { createWorkspaceDriver } from "./drivers/index.mjs";
import { WorkspaceDriverError } from "./drivers/errors.mjs";
import { createOysterUiGateway } from "./ui-gateway.mjs";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);
const AGGREGATE_RESOURCES = ["health", "runners", "sessions?all=1", "routines", "tunnels"];

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function tokenMatches(expected, candidate) {
  if (!candidate) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(String(candidate).trim());
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorized(req, expected, url = null) {
  const bearer = req.headers.authorization;
  const cookie = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("pi_ui_token="));
  let cookieToken = null;
  try { cookieToken = cookie ? decodeURIComponent(cookie.slice("pi_ui_token=".length)) : null; } catch {}
  const candidates = [
    bearer?.startsWith("Bearer ") ? bearer.slice(7) : bearer,
    req.headers["x-api-key"],
    req.headers["x-auth-token"],
    url?.searchParams.get("token"),
    cookieToken,
  ];
  return candidates.some((candidate) => tokenMatches(expected, candidate));
}

function workspaceUrl(workspace, pathAndQuery) {
  return `${workspace.url}/${String(pathAndQuery).replace(/^\/+/, "")}`;
}

function driverDescriptor(driver) {
  return { type: driver.type, endpoint: driver.endpoint, capabilities: driver.capabilities };
}

function upstreamHeaders(req, workspace) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && !["authorization", "x-api-key", "x-auth-token", "cookie"].includes(name.toLowerCase()) && value != null) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  if (workspace.token) headers.set("authorization", `Bearer ${workspace.token}`);
  return headers;
}

async function readRequestBody(req) {
  if (["GET", "HEAD"].includes(req.method)) return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function fetchJson(workspace, path, { fetchImpl, timeoutMs }) {
  const startedAt = performance.now();
  try {
    const headers = { accept: "application/json" };
    if (workspace.token) headers.authorization = `Bearer ${workspace.token}`;
    const response = await fetchImpl(workspaceUrl(workspace, path), {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let value;
    try { value = text ? JSON.parse(text) : null; } catch { throw new Error(`upstream returned non-JSON (${response.status})`); }
    if (!response.ok) throw new Error(value?.error || `upstream returned ${response.status}`);
    return { ok: true, value, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : error.message, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

async function listEnvironments(driver) {
  if (typeof driver.listEnvironments === "function") return driver.listEnvironments();
  const workspaces = await driver.listWorkspaces();
  return [...new Map(workspaces.map((workspace) => {
    const id = workspace.environmentId || workspace.provider?.spoke || "unassigned-device";
    return [id, { id, name: workspace.environmentName || id, status: "online" }];
  })).values()];
}

function publicWorkspace(workspace) {
  return {
    environmentId: workspace.environmentId,
    environmentName: workspace.environmentName,
    id: workspace.id,
    name: workspace.name,
    url: workspace.url,
    provider: workspace.provider,
  };
}

async function inspectWorkspace(workspace, options, full = false) {
  if (!workspace.url) {
    const unavailable = ["broken", "unreachable", "terminated", "exited"].includes(workspace.provider?.phase)
      || ["unreachable", "terminated", "exited"].includes(workspace.provider?.state);
    return {
      ...publicWorkspace(workspace),
      status: unavailable ? "offline" : "provisioning",
      latencyMs: null,
      results: {},
      errors: { endpoint: "Oyster endpoint is not exposed yet" },
    };
  }
  const resources = full ? AGGREGATE_RESOURCES : ["health"];
  const responses = await Promise.all(resources.map((path) => fetchJson(workspace, path, options)));
  const results = {};
  const errors = {};
  resources.forEach((path, index) => {
    const key = path.split("?")[0];
    if (responses[index].ok) results[key] = responses[index].value;
    else errors[key] = responses[index].error;
  });
  const health = responses[0];
  return {
    ...publicWorkspace(workspace),
    status: health.ok && health.value?.ok !== false ? "online" : "offline",
    latencyMs: health.latencyMs,
    results,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

function overviewTotals(workspaces) {
  const arrays = (workspace, resource, key) => workspace.results?.[resource]?.[key] ?? [];
  const runners = workspaces.flatMap((workspace) => arrays(workspace, "runners", "runners"));
  const sessions = workspaces.flatMap((workspace) => arrays(workspace, "sessions", "sessions"));
  const routines = workspaces.flatMap((workspace) => arrays(workspace, "routines", "routines"));
  const hublots = workspaces.flatMap((workspace) => arrays(workspace, "tunnels", "tunnels"));
  return {
    workspaces: workspaces.length,
    online: workspaces.filter((workspace) => workspace.status === "online").length,
    offline: workspaces.filter((workspace) => workspace.status === "offline").length,
    provisioning: workspaces.filter((workspace) => workspace.status === "provisioning").length,
    runners: runners.length,
    runningRunners: runners.filter((runner) => runner.alive).length,
    busyRunners: runners.filter((runner) => runner.busy).length,
    sessions: sessions.length,
    routines: routines.length,
    runningRoutines: routines.filter((routine) => routine.status === "running").length,
    hublots: hublots.length,
    openHublots: hublots.filter((tunnel) => tunnel.status === "open" || tunnel.publicUrl || tunnel.public_url).length,
  };
}

async function proxyWorkspace(req, res, url, workspace, suffix, options) {
  const target = workspaceUrl(workspace, `${suffix || "/"}${url.search}`);
  const controller = new AbortController();
  let connectTimer;
  try {
    const body = await readRequestBody(req);
    connectTimer = setTimeout(
      () => controller.abort(new Error(`workspace timed out after ${options.timeoutMs}ms`)),
      options.timeoutMs,
    );
    const response = await options.fetchImpl(target, {
      method: req.method,
      headers: upstreamHeaders(req, workspace),
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(connectTimer);
    connectTimer = null;
    res.once("close", () => controller.abort());
    const headers = {};
    response.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") headers[name] = value;
    });
    headers["x-oyster-workspace"] = workspace.id;
    res.writeHead(response.status, headers);
    if (!response.body || req.method === "HEAD") return res.end();
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (!res.headersSent) json(res, 502, { error: "workspace request failed", workspace: workspace.id, detail: error.message });
    else res.destroy(error);
  } finally {
    if (connectTimer) clearTimeout(connectTimer);
  }
}

export function createOysterHub(config, {
  fetchImpl = globalThis.fetch,
  logger = console,
  driver = createWorkspaceDriver(config.driver, { fetchImpl }),
  dashboardPath = new URL("./public/index.html", import.meta.url),
  openApiPath = new URL("./openapi.json", import.meta.url),
} = {}) {
  const options = { fetchImpl, timeoutMs: config.timeoutMs };
  const uiGateway = createOysterUiGateway({
    config,
    driver,
    fetchImpl,
    logger,
    authorized: (req, url) => authorized(req, config.token, url),
    json,
  });

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://hub.local");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, service: "oyster-hub", driver: driverDescriptor(driver) });
      }
      if (await uiGateway.handle(req, res, url)) return;
      if (!url.pathname.startsWith("/api/v1/") && url.pathname !== "/api/v1") {
        return json(res, 404, { error: "not found" });
      }
      if (!authorized(req, config.token)) {
        res.setHeader("www-authenticate", 'Bearer realm="oyster-hub"');
        return json(res, 401, { error: `unauthorized for ${req.method} ${url.pathname}` });
      }
      if (req.method === "GET" && url.pathname === "/api/v1/openapi.json") {
        const body = await readFile(openApiPath);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
        return res.end(body);
      }
      if (url.pathname === "/api/v1/environments" && req.method === "GET") {
        return json(res, 200, { environments: await listEnvironments(driver) });
      }
      if (url.pathname === "/api/v1/workspaces" && req.method === "GET") {
        const discovered = await driver.listWorkspaces();
        const workspaces = await Promise.all(discovered.map((workspace) => inspectWorkspace(workspace, options)));
        return json(res, 200, { driver: driverDescriptor(driver), workspaces });
      }
      if (url.pathname === "/api/v1/workspaces" && req.method === "POST") {
        if (!driver.capabilities?.create) {
          return json(res, 405, { error: `${driver.type} workspace driver cannot create workspaces` });
        }
        let body;
        try {
          const raw = await readRequestBody(req);
          body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        } catch (error) {
          return json(res, 400, { error: `invalid JSON: ${error.message}` });
        }
        const workspace = await driver.createWorkspace(body);
        return json(res, 201, { workspace });
      }
      if (req.method === "GET" && url.pathname === "/api/v1/overview") {
        const discovered = await driver.listWorkspaces();
        const workspaces = await Promise.all(discovered.map((workspace) => inspectWorkspace(workspace, options, true)));
        return json(res, 200, { generatedAt: new Date().toISOString(), driver: driverDescriptor(driver), totals: overviewTotals(workspaces), workspaces });
      }

      const match = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)(\/.*)?$/);
      if (match) {
        let wid;
        try { wid = decodeURIComponent(match[1]); } catch { return json(res, 400, { error: "invalid workspace id" }); }
        const workspace = await driver.getWorkspace(wid);
        if (!workspace) return json(res, 404, { error: "workspace not found", workspace: wid });
        if (!match[2]) {
          if (req.method === "DELETE" && !driver.capabilities?.remove) {
            return json(res, 405, { error: `${driver.type} workspace driver cannot remove workspaces` });
          }
          if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
          return json(res, 200, await inspectWorkspace(workspace, options));
        }
        if (!workspace.url) {
          return json(res, 503, { error: "workspace endpoint is not ready", workspace: wid });
        }
        return proxyWorkspace(req, res, url, workspace, match[2], options);
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      logger.error("oyster-hub request failed", error);
      if (!res.headersSent && error instanceof WorkspaceDriverError) {
        json(res, error.status, { error: error.message, driver: driver.type });
      } else if (!res.headersSent) json(res, 500, { error: "internal server error" });
      else res.destroy(error);
    }
  });
}
