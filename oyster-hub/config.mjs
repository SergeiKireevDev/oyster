import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function httpUrl(value, label) {
  const raw = requireString(value, label);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} is not a valid URL: ${raw}`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} must use http or https: ${raw}`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials: ${raw}`);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function nonNegativeInteger(value, label, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return number;
}

function validateMockWorkspace(input, env, index = null) {
  const prefix = index == null ? "driver" : `driver.workspaces[${index}]`;
  const id = String(input.id || (index == null ? "local" : "")).trim();
  if (!WORKSPACE_ID.test(id)) throw new Error(`invalid mock workspace id: ${id}`);
  const token = env.OYSTER_HUB_DRIVER_TOKEN ?? input.token;
  const environmentId = typeof input.environmentId === "string" && input.environmentId.trim() ? input.environmentId.trim() : "local";
  const environmentName = typeof input.environmentName === "string" && input.environmentName.trim() ? input.environmentName.trim() : (environmentId === "local" ? "Local" : environmentId);
  return Object.freeze({
    endpoint: httpUrl(index == null ? (env.OYSTER_HUB_DRIVER_ENDPOINT || input.endpoint || "http://localhost:8080") : input.endpoint, `${prefix}.endpoint`),
    environmentId,
    environmentName,
    id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : (index == null ? "Local Oyster" : id),
    token: typeof token === "string" && token.trim() ? token.trim() : null,
  });
}

function validateMockDriver(input, env) {
  if (input.workspaces != null) {
    if (!Array.isArray(input.workspaces) || !input.workspaces.length) throw new Error("driver.workspaces must be a non-empty array");
    const workspaces = input.workspaces.map((workspace, index) => validateMockWorkspace(workspace, env, index));
    if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length) throw new Error("mock workspace ids must be unique");
    return Object.freeze({ type: "mock", endpoint: "multiple", workspaces: Object.freeze(workspaces) });
  }
  return Object.freeze({ type: "mock", ...validateMockWorkspace(input, env) });
}

function validateLlmboxDriver(input, env, timeoutMs) {
  const workspacePort = Number(input.workspacePort ?? 8080);
  if (!Number.isInteger(workspacePort) || workspacePort < 1 || workspacePort > 65535) {
    throw new Error("driver.workspacePort must be between 1 and 65535");
  }
  const tokenFile = input.tokenFile || {};
  const path = requireString(tokenFile.path || "/run/secrets/oyster-ui-token", "driver.tokenFile.path");
  if (!path.startsWith("/")) throw new Error("driver.tokenFile.path must be absolute");
  const mode = nonNegativeInteger(tokenFile.mode, "driver.tokenFile.mode", 0o600);
  if (mode > 0o777) throw new Error("driver.tokenFile.mode must be at most 511 (0777)");

  return Object.freeze({
    type: "llmbox",
    endpoint: httpUrl(env.OYSTER_HUB_DRIVER_ENDPOINT || input.endpoint, "driver.endpoint"),
    token: requireString(env.OYSTER_HUB_DRIVER_TOKEN || input.token, "driver.token"),
    tokenSecret: requireString(env.OYSTER_HUB_WORKSPACE_TOKEN_SECRET || input.tokenSecret, "driver.tokenSecret"),
    timeoutMs,
    workspacePort,
    createProxy: input.createProxy !== false,
    tokenFile: Object.freeze({
      path,
      mode,
      uid: nonNegativeInteger(tokenFile.uid, "driver.tokenFile.uid", 0),
      gid: nonNegativeInteger(tokenFile.gid, "driver.tokenFile.gid", 0),
    }),
  });
}

export function validateConfig(input, env = process.env) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("hub config must be an object");
  const token = requireString(env.OYSTER_HUB_TOKEN || input.token, "token");
  const port = Number(env.PORT || input.port || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${port}`);
  const timeoutMs = Number(input.timeoutMs || 5000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error("timeoutMs must be between 100 and 120000");
  }

  const driverInput = input.driver;
  if (!driverInput || typeof driverInput !== "object" || Array.isArray(driverInput)) {
    throw new Error("driver must be an object");
  }
  const driverType = requireString(driverInput.type, "driver.type");
  let driver;
  if (driverType === "llmbox") driver = validateLlmboxDriver(driverInput, env, timeoutMs);
  else if (driverType === "mock") driver = validateMockDriver(driverInput, env);
  else throw new Error(`unsupported workspace driver: ${driverType}`);

  return Object.freeze({
    host: String(env.HOST || input.host || "127.0.0.1"),
    port,
    token,
    timeoutMs,
    driver,
  });
}

export async function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const flagIndex = argv.indexOf("--config");
  if (flagIndex >= 0 && !argv[flagIndex + 1]) throw new Error("--config requires a path");
  const configPath = resolve(flagIndex >= 0 ? argv[flagIndex + 1] : (env.OYSTER_HUB_CONFIG || "oyster-hub/config.json"));
  const source = await readFile(configPath, "utf8");
  let parsed;
  try { parsed = JSON.parse(source); } catch (error) { throw new Error(`cannot parse ${configPath}: ${error.message}`); }
  let resolvedEnv = env;
  const sharedTokenFile = env.OYSTER_HUB_SHARED_TOKEN_FILE || parsed.sharedTokenFile;
  if (sharedTokenFile) {
    if (parsed.driver?.type !== "mock") throw new Error("sharedTokenFile is only supported by the mock workspace driver");
    const tokenPath = resolve(dirname(configPath), requireString(sharedTokenFile, "sharedTokenFile"));
    let sharedToken;
    try { sharedToken = requireString(await readFile(tokenPath, "utf8"), "shared token file"); }
    catch (error) { throw new Error(`cannot read shared token file ${tokenPath}: ${error.message}`); }
    resolvedEnv = {
      ...env,
      OYSTER_HUB_TOKEN: env.OYSTER_HUB_TOKEN || sharedToken,
      OYSTER_HUB_DRIVER_TOKEN: env.OYSTER_HUB_DRIVER_TOKEN || sharedToken,
    };
  }
  return { config: validateConfig(parsed, resolvedEnv), configPath };
}
