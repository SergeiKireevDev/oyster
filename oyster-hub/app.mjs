import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createWorkspaceDriver } from "./drivers/index.mjs";
import { WorkspaceDriverError } from "./drivers/errors.mjs";
import { createOysterUiGateway } from "./ui-gateway.mjs";
import { createUploadLimiter, prepareOpaqueWorkspaceRequest, proxyWorkspaceRequest, readBufferedRequestBody } from "./workspace-proxy.mjs";
import { CloudProvisioningError, createCloudProvisioningService } from "./cloud-provisioning.mjs";
import { CloudAuthorizationError, createCloudAuthorizationService } from "./cloud-authorization.mjs";
import { createBoxConnectionRegistry } from "./box-registry.mjs";

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
  return {
    type: driver.type,
    endpoint: driver.endpoint,
    capabilities: driver.capabilities,
    ...(driver.drivers ? { drivers: driver.drivers.map(driverDescriptor) } : {}),
  };
}

async function fetchJson(workspace, path, { fetchImpl, timeoutMs }) {
  const startedAt = performance.now();
  try {
    const headers = { accept: "application/json" };
    if (workspace.token) headers.authorization = `Bearer ${workspace.token}`;
    const response = await (workspace.fetchImpl || fetchImpl)(workspaceUrl(workspace, path), {
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

async function listDriverEnvironments(driver) {
  if (typeof driver.listEnvironments === "function") return driver.listEnvironments();
  const workspaces = await driver.listWorkspaces();
  return [...new Map(workspaces.map((workspace) => {
    const id = workspace.environmentId || workspace.provider?.spoke || "unassigned-device";
    return [id, { id, name: workspace.environmentName || id, kind: driver.type === "mock" ? "local" : driver.type, status: "online", local: driver.type === "mock" }];
  })).values()];
}

async function listEnvironments(driver, cloudService) {
  const [driverEnvironments, cloudEnvironments] = await Promise.all([
    listDriverEnvironments(driver),
    cloudService.listEnvironments(),
  ]);
  return [...new Map([...cloudEnvironments, ...driverEnvironments].map((environment) => [environment.id, environment])).values()];
}

async function readJsonBody(req) {
  try {
    const raw = await readBufferedRequestBody(req, 128 * 1024);
    return raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch (error) {
    if (error instanceof CloudProvisioningError) throw error;
    if (error.code === "body_too_large") throw new CloudProvisioningError("request body is too large", { status: 413 });
    throw new CloudProvisioningError(`invalid JSON: ${error.message}`, { status: 400 });
  }
}

function publicWorkspace(workspace) {
  return {
    environmentId: workspace.environmentId,
    environmentName: workspace.environmentName,
    id: workspace.id,
    name: workspace.name,
    url: workspace.url,
    createdAt: workspace.createdAt,
    provider: workspace.provider,
  };
}

function summarizeWorkspace(workspace) {
  const declaredStatus = String(workspace.status || "").toLowerCase();
  const providerPhase = String(workspace.provider?.phase || "").toLowerCase();
  const providerState = String(workspace.provider?.state || "").toLowerCase();
  const unavailableStatuses = ["broken", "unreachable", "terminated", "exited", "failed", "offline"];
  const lifecycleStatuses = ["provisioning", "awaiting_agent", "initializing", "paused", "pausing", "resuming", "destroying"];
  const unavailable = unavailableStatuses.includes(declaredStatus)
    || unavailableStatuses.includes(providerPhase)
    || unavailableStatuses.includes(providerState);
  const status = unavailable
    ? "offline"
    : declaredStatus && declaredStatus !== "active"
      ? declaredStatus
      : lifecycleStatuses.includes(providerPhase)
        ? providerPhase
        : workspace.url ? "online" : "provisioning";
  return { ...publicWorkspace(workspace), status, latencyMs: null, results: {} };
}

async function inspectWorkspace(workspace, options, full = false) {
  if (!workspace.url) {
    const unavailable = ["broken", "unreachable", "terminated", "exited"].includes(workspace.provider?.phase)
      || ["unreachable", "terminated", "exited"].includes(workspace.provider?.state);
    return {
      ...publicWorkspace(workspace),
      status: unavailable ? "offline" : (workspace.status || workspace.provider?.phase || "provisioning"),
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
  const lifecycleStatus = workspace.status || workspace.provider?.phase;
  const controlledStatus = ["paused", "pausing", "destroying"].includes(lifecycleStatus) ? lifecycleStatus : null;
  const pendingStatus = ["provisioning", "awaiting_agent", "initializing", "resuming"].includes(lifecycleStatus) ? lifecycleStatus : null;
  return {
    ...publicWorkspace(workspace),
    status: controlledStatus || (health.ok && health.value?.ok !== false ? "online" : (pendingStatus || "offline")),
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
  return proxyWorkspaceRequest({
    req,
    res,
    target: workspaceUrl(workspace, `${suffix || "/"}${url.search}`),
    workspace,
    prepared: prepareOpaqueWorkspaceRequest(req),
    fetchImpl: workspace.fetchImpl || options.fetchImpl,
    timeoutMs: options.timeoutMs,
    uploadIdleTimeoutMs: options.uploadIdleTimeoutMs,
    uploadResponseTimeoutMs: options.uploadResponseTimeoutMs,
    json,
    onTransfer: options.onTransfer,
    uploadLimiter: options.uploadLimiter,
  });
}

export function createOysterHub(config, {
  fetchImpl = globalThis.fetch,
  logger = console,
  driver = createWorkspaceDriver(config.driver, { fetchImpl }),
  dashboardPath = new URL("./public/index.html", import.meta.url),
  openApiPath = new URL("./openapi.json", import.meta.url),
  onTransfer,
  boxRegistry = createBoxConnectionRegistry({ stateFile: config.cloud?.registryStateFile, logger }),
  cloudService = null,
  authorizationService = null,
} = {}) {
  const uploadLimiter = createUploadLimiter(config.maxConcurrentUploads);
  const cloud = cloudService || createCloudProvisioningService({
    stateFile: config.cloud?.stateFile,
    fetchImpl,
    boxRegistry,
    boxConnectUrl: config.cloud?.boxConnectUrl,
    repository: config.cloud?.repository,
    ref: config.cloud?.ref,
    oauth: config.cloud?.oauth,
    aws: config.cloud?.aws,
    credentialEncryptionKey: config.cloud?.credentialEncryptionKey,
  });
  const cloudAuthorization = authorizationService || createCloudAuthorizationService({
    config: config.cloud?.oauth,
    fetchImpl,
    saveCredential: (provider, credential) => {
      if (typeof cloud.configureOAuth !== "function") throw new CloudProvisioningError("cloud OAuth storage is unavailable", { status: 503 });
      return cloud.configureOAuth(provider, credential);
    },
  });
  const options = {
    fetchImpl,
    timeoutMs: config.timeoutMs,
    uploadIdleTimeoutMs: config.uploadIdleTimeoutMs,
    uploadResponseTimeoutMs: config.uploadResponseTimeoutMs,
    onTransfer,
    uploadLimiter,
  };
  let workspaceDiscovery = { value: null, expiresAt: 0, promise: null };
  const invalidateWorkspaceDiscovery = () => { workspaceDiscovery = { value: null, expiresAt: 0, promise: null }; };
  const listWorkspaces = async () => {
    const timestamp = Date.now();
    if (workspaceDiscovery.value && workspaceDiscovery.expiresAt > timestamp) return workspaceDiscovery.value;
    if (workspaceDiscovery.promise) return workspaceDiscovery.promise;
    workspaceDiscovery.promise = Promise.all([
      driver.listWorkspaces(),
      cloud.listWorkspaces ? cloud.listWorkspaces() : [],
    ]).then(([driverWorkspaces, cloudWorkspaces]) => {
      const value = [...driverWorkspaces, ...cloudWorkspaces];
      workspaceDiscovery = { value, expiresAt: Date.now() + 2000, promise: null };
      return value;
    }).catch((error) => {
      workspaceDiscovery = { value: null, expiresAt: 0, promise: null };
      throw error;
    });
    return workspaceDiscovery.promise;
  };
  const uiGateway = createOysterUiGateway({
    config,
    driver,
    fetchImpl,
    logger,
    authorized: (req, url) => authorized(req, config.token, url),
    json,
    onTransfer,
    uploadLimiter,
    listWorkspaces,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://hub.local");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, service: "oyster-hub", driver: driverDescriptor(driver) });
      }
      const oauthCallbackMatch = url.pathname.match(/^\/cloud\/oauth\/(digitalocean|gcp)\/callback$/);
      if (oauthCallbackMatch && req.method === "GET") {
        const flow = await cloudAuthorization.callback(oauthCallbackMatch[1], Object.fromEntries(url.searchParams));
        const target = `${config.cloud?.publicUrl || ""}/?cloud-connect=${encodeURIComponent(flow.id)}`;
        res.writeHead(303, { location: target, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        return res.end();
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
        return json(res, 200, { environments: await listEnvironments(driver, cloud) });
      }
      if (url.pathname === "/api/v1/environments" && req.method === "POST") {
        return json(res, 405, { error: "environments are connections; create a workspace with POST /api/v1/workspaces" });
      }
      if (url.pathname === "/api/v1/cloud/providers" && req.method === "GET") {
        return json(res, 200, { providers: await cloud.listProviders() });
      }
      const handoffStartMatch = url.pathname.match(/^\/api\/v1\/cloud\/providers\/([^/]+)\/handoff\/start$/);
      if (handoffStartMatch && req.method === "POST") {
        return json(res, 202, { flow: await cloud.startHandoff(decodeURIComponent(handoffStartMatch[1])) });
      }
      const handoffStatusMatch = url.pathname.match(/^\/api\/v1\/cloud\/handoff\/([^/]+)\/(status|cancel)$/);
      if (handoffStatusMatch) {
        const flowId = decodeURIComponent(handoffStatusMatch[1]);
        if (handoffStatusMatch[2] === "status" && req.method === "GET") return json(res, 200, { flow: await cloud.handoffStatus(flowId) });
        if (handoffStatusMatch[2] === "cancel" && req.method === "POST") return json(res, 200, { flow: await cloud.cancelHandoff(flowId) });
        return json(res, 405, { error: "method not allowed" });
      }
      if (url.pathname === "/api/v1/cloud/providers/aws/role/start" && req.method === "POST") {
        const body = await readJsonBody(req);
        return json(res, 202, { flow: await cloud.startAwsRole(body.accountId) });
      }
      const awsRoleVerifyMatch = url.pathname.match(/^\/api\/v1\/cloud\/authorization\/aws\/([^/]+)\/verify$/);
      if (awsRoleVerifyMatch && req.method === "POST") {
        return json(res, 200, { flow: await cloud.verifyAwsRole(decodeURIComponent(awsRoleVerifyMatch[1])) });
      }
      const authorizationStartMatch = url.pathname.match(/^\/api\/v1\/cloud\/providers\/([^/]+)\/authorization\/start$/);
      if (authorizationStartMatch && req.method === "POST") {
        return json(res, 202, { flow: cloudAuthorization.start(decodeURIComponent(authorizationStartMatch[1])) });
      }
      const authorizationFlowMatch = url.pathname.match(/^\/api\/v1\/cloud\/authorization\/([^/]+)\/(status|cancel)$/);
      if (authorizationFlowMatch) {
        const flowId = decodeURIComponent(authorizationFlowMatch[1]);
        if (authorizationFlowMatch[2] === "status" && req.method === "GET") return json(res, 200, { flow: cloudAuthorization.status(flowId) });
        if (authorizationFlowMatch[2] === "cancel" && req.method === "POST") return json(res, 200, { flow: cloudAuthorization.cancel(flowId) });
        return json(res, 405, { error: "method not allowed" });
      }
      const projectMatch = url.pathname.match(/^\/api\/v1\/cloud\/providers\/([^/]+)\/projects$/);
      if (projectMatch) {
        const providerId = decodeURIComponent(projectMatch[1]);
        if (req.method === "GET") return json(res, 200, { provider: providerId, projects: await cloud.listProjects(providerId) });
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          return json(res, 200, { credential: await cloud.selectProject(providerId, body.projectId) });
        }
        return json(res, 405, { error: "method not allowed" });
      }
      const cloudProviderMatch = url.pathname.match(/^\/api\/v1\/cloud\/providers\/([^/]+)\/(credentials|options)$/);
      if (cloudProviderMatch) {
        let providerId;
        try { providerId = decodeURIComponent(cloudProviderMatch[1]); }
        catch { return json(res, 400, { error: "invalid cloud provider id" }); }
        if (cloudProviderMatch[2] === "credentials" && req.method === "PUT") {
          return json(res, 200, { credential: await cloud.configure(providerId, await readJsonBody(req)) });
        }
        if (cloudProviderMatch[2] === "credentials" && req.method === "DELETE") {
          return json(res, 200, { credential: await cloud.removeCredentials(providerId) });
        }
        if (cloudProviderMatch[2] === "options" && req.method === "GET") {
          return json(res, 200, { provider: providerId, ...(await cloud.options(providerId, { region: url.searchParams.get("region") || "" })) });
        }
        return json(res, 405, { error: "method not allowed" });
      }
      if (url.pathname === "/api/v1/workspaces" && req.method === "GET") {
        const discovered = await listWorkspaces();
        const workspaces = url.searchParams.get("probe") === "0"
          ? discovered.map(summarizeWorkspace)
          : await Promise.all(discovered.map((workspace) => inspectWorkspace(workspace, options)));
        return json(res, 200, { driver: driverDescriptor(driver), workspaces });
      }
      if (url.pathname === "/api/v1/workspaces" && req.method === "POST") {
        const body = await readJsonBody(req);
        let workspace;
        if (body.provider) workspace = await cloud.provision(body);
        else {
          if (!driver.capabilities?.create) {
            return json(res, 405, { error: `${driver.type} workspace driver cannot create workspaces` });
          }
          workspace = await driver.createWorkspace(body);
        }
        invalidateWorkspaceDiscovery();
        return json(res, 201, { workspace });
      }
      if (req.method === "GET" && url.pathname === "/api/v1/overview") {
        const discovered = [...await driver.listWorkspaces(), ...(cloud.listWorkspaces ? await cloud.listWorkspaces() : [])];
        const workspaces = await Promise.all(discovered.map((workspace) => inspectWorkspace(workspace, options, true)));
        return json(res, 200, { generatedAt: new Date().toISOString(), driver: driverDescriptor(driver), totals: overviewTotals(workspaces), workspaces });
      }

      const match = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)(\/.*)?$/);
      if (match) {
        let wid;
        try { wid = decodeURIComponent(match[1]); } catch { return json(res, 400, { error: "invalid workspace id" }); }
        const driverWorkspace = await driver.getWorkspace(wid);
        const cloudWorkspace = driverWorkspace ? null : (cloud.getWorkspace ? await cloud.getWorkspace(wid) : null);
        const workspace = driverWorkspace || cloudWorkspace;
        if (!workspace) return json(res, 404, { error: "workspace not found", workspace: wid });
        if (!match[2]) {
          if (req.method === "DELETE") {
            if (cloudWorkspace) {
              const destroyed = await cloud.destroy(wid);
              invalidateWorkspaceDiscovery();
              return json(res, 200, { workspace: destroyed });
            }
            if (!driver.capabilities?.remove) return json(res, 405, { error: `${driver.type} workspace driver cannot remove workspaces` });
            await driver.removeWorkspace(wid);
            invalidateWorkspaceDiscovery();
            return json(res, 200, { workspace: { id: wid, destroyed: true } });
          }
          if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
          return json(res, 200, await inspectWorkspace(workspace, options));
        }
        if (match[2] === "/actions") {
          if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
          if (!cloudWorkspace) return json(res, 405, { error: "workspace lifecycle actions are only supported for cloud workspaces" });
          const { action } = await readJsonBody(req);
          const updated = action === "pause"
            ? await cloud.pause(wid)
            : action === "resume"
              ? await cloud.resume(wid)
              : null;
          if (!updated) return json(res, 400, { error: "action must be pause or resume" });
          invalidateWorkspaceDiscovery();
          return json(res, 200, { workspace: updated });
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
      } else if (!res.headersSent && (error instanceof CloudProvisioningError || error instanceof CloudAuthorizationError)) {
        json(res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
      } else if (!res.headersSent) json(res, 500, { error: "internal server error" });
      else res.destroy(error);
    }
  });
  boxRegistry.attach?.(server);
  server.once("close", () => cloudAuthorization.close?.());
  server.boxRegistry = boxRegistry;
  return server;
}
