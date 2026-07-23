import { createHmac } from "node:crypto";
import { WorkspaceDriverError } from "./errors.mjs";

const BOX_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function deriveWorkspaceToken(secret, workspaceId) {
  return `oyster_${createHmac("sha256", secret).update(`oyster-workspace:${workspaceId}`).digest("base64url")}`;
}

function boxId(box) {
  return String(box?.box_id || box?.name || box?.instance_id || "");
}

function publicProviderState(box) {
  return {
    type: "llmbox",
    instanceId: box.instance_id || null,
    spoke: box.spoke || null,
    state: box.state || "unknown",
    phase: box.phase || null,
    status: box.status || null,
    createdAt: Number.isFinite(box.created) && box.created > 0 ? new Date(box.created * 1000).toISOString() : null,
    ...(box.last_error ? { lastError: box.last_error } : {}),
  };
}

export function createLlmboxDriver(config, { fetchImpl = globalThis.fetch, binding = null } = {}) {
  const endpoint = config.endpoint.replace(/\/$/, "");
  if (config.transport === "native" && typeof binding?.invoke !== "function") {
    throw new Error("native llmbox driver requires an open binding");
  }

  async function call(path, body = {}) {
    if (config.transport === "native") {
      try {
        return await binding.invoke(path, body);
      } catch (error) {
        throw new WorkspaceDriverError(`llmbox ${path} native call failed: ${error.message}`, { cause: error });
      }
    }
    let response;
    try {
      response = await fetchImpl(`${endpoint}/api/v1/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new WorkspaceDriverError(`llmbox ${path} request failed: ${error.message}`, { cause: error });
    }
    const text = await response.text();
    let value;
    try { value = text ? JSON.parse(text) : {}; }
    catch { throw new WorkspaceDriverError(`llmbox ${path} returned non-JSON (${response.status})`); }
    if (!response.ok) {
      throw new WorkspaceDriverError(value?.error || `llmbox ${path} returned ${response.status}`, {
        status: response.status >= 400 && response.status < 500 ? response.status : 502,
      });
    }
    return value;
  }

  async function listEnvironments() {
    const response = await call("spoke-statuses");
    return (Array.isArray(response.spokes) ? response.spokes : [])
      .map((spoke) => ({
        id: String(spoke?.name || ""),
        name: String(spoke?.name || ""),
        status: spoke?.connected ? "online" : "offline",
        default: Boolean(spoke?.default),
      }))
      .filter((environment) => environment.id);
  }

  async function listWorkspaces() {
    const [boxResponse, proxyResponse] = await Promise.all([
      call("list-boxes"),
      call("list-proxies"),
    ]);
    const proxies = Array.isArray(proxyResponse.proxies) ? proxyResponse.proxies : [];
    return (Array.isArray(boxResponse.boxes) ? boxResponse.boxes : [])
      .map((box) => {
        const id = boxId(box);
        const proxy = proxies.find((candidate) => candidate.box_id === id && candidate.port === config.workspacePort);
        const environmentId = String(box.spoke || "unassigned-device");
        return {
          environmentId,
          environmentName: environmentId,
          id,
          name: box.description || id,
          url: proxy?.url ? String(proxy.url).replace(/\/$/, "") : null,
          token: deriveWorkspaceToken(config.tokenSecret, id),
          provider: publicProviderState(box),
        };
      })
      .filter((workspace) => workspace.id);
  }

  async function getWorkspace(id) {
    return (await listWorkspaces()).find((workspace) => workspace.id === id) || null;
  }

  async function createWorkspace(input) {
    const id = String(input?.id || "").trim();
    if (!BOX_ID.test(id)) {
      throw new WorkspaceDriverError("id must be a 1-63 character lowercase DNS label", { status: 400 });
    }
    const description = String(input?.name || input?.description || "").trim().slice(0, 500);
    const spoke = String(input?.spoke || "").trim().slice(0, 100);
    const diskBytes = input?.diskBytes == null ? 0 : Number(input.diskBytes);
    if (!Number.isSafeInteger(diskBytes) || diskBytes < 0) {
      throw new WorkspaceDriverError("diskBytes must be a non-negative safe integer", { status: 400 });
    }

    const workspaceToken = deriveWorkspaceToken(config.tokenSecret, id);
    const tokenFile = config.tokenFile;
    const opts = {
      BoxID: id,
      Description: description,
      SpokeName: spoke,
      Files: [{
        Path: tokenFile.path,
        Content: Buffer.from(`${workspaceToken}\n`).toString("base64"),
        Mode: tokenFile.mode,
        UID: tokenFile.uid,
        GID: tokenFile.gid,
      }],
    };
    if (diskBytes > 0) opts.DiskBytes = diskBytes;

    const created = await call("create-box", { opts });
    let proxy = null;
    let warning = null;
    if (config.createProxy) {
      try {
        const response = await call("create-proxy", {
          box_id: id,
          port: config.workspacePort,
          description: "Oyster workspace",
        });
        proxy = response.proxy || null;
      } catch (error) {
        warning = `workspace created but its Oyster endpoint could not be exposed: ${error.message}`;
      }
    }

    const environmentId = spoke || "unassigned-device";
    return {
      environmentId,
      environmentName: environmentId,
      id,
      name: description || id,
      url: proxy?.url ? String(proxy.url).replace(/\/$/, "") : null,
      provider: { type: "llmbox", session: created.session || null },
      ...(warning ? { warning } : {}),
    };
  }

  return Object.freeze({
    type: "llmbox",
    endpoint,
    capabilities: Object.freeze({ list: true, create: true, remove: false }),
    listEnvironments,
    listWorkspaces,
    getWorkspace,
    createWorkspace,
  });
}
