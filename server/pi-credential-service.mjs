import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CAPABILITY_ERROR = "credential_service_unavailable";

function credentialError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function capabilityError(message, cause) {
  return credentialError(CAPABILITY_ERROR, message, cause);
}

function exportedEntryTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const condition of ["import", "node", "default"]) {
    const target = exportedEntryTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

function packageEntry(packageRoot, manifest) {
  const exported = exportedEntryTarget(manifest.exports?.["."] ?? (typeof manifest.exports === "string" ? manifest.exports : null));
  const target = exported ?? manifest.main;
  if (typeof target !== "string" || !target.trim()) return null;
  const entry = resolve(packageRoot, target);
  return entry === packageRoot || entry.startsWith(`${packageRoot}/`) ? entry : null;
}

function declaredBins(packageRoot, manifest) {
  if (typeof manifest.bin === "string") return [resolve(packageRoot, manifest.bin)];
  if (!manifest.bin || typeof manifest.bin !== "object" || Array.isArray(manifest.bin)) return [];
  return Object.values(manifest.bin)
    .filter((value) => typeof value === "string")
    .map((value) => resolve(packageRoot, value));
}

/** Resolve the SDK exported by the package that owns the configured pi executable. */
export function resolveConfiguredPiSdk(piBin) {
  if (typeof piBin !== "string" || !piBin.trim()) {
    throw capabilityError("configured PI_BIN is required to load pi credential support");
  }

  let executable;
  try {
    executable = realpathSync(piBin);
  } catch (cause) {
    throw capabilityError(`configured pi executable cannot be resolved for credential support: ${piBin}`, cause);
  }

  let directory = dirname(executable);
  const root = parse(directory).root;
  while (true) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (cause) {
        throw capabilityError(`configured pi package metadata is unreadable: ${manifestPath}`, cause);
      }

      const ownsExecutable = declaredBins(directory, manifest).some((candidate) => {
        try { return realpathSync(candidate) === executable; } catch { return resolve(candidate) === executable; }
      });
      if (ownsExecutable) {
        const entry = packageEntry(directory, manifest);
        if (!entry || !existsSync(entry)) {
          throw capabilityError(`configured pi package does not expose an importable SDK entry: ${manifestPath}`);
        }
        return Object.freeze({ executable, packageRoot: directory, manifestPath, entry: realpathSync(entry) });
      }
    }
    if (directory === root) break;
    directory = dirname(directory);
  }

  throw capabilityError(`configured pi executable is not owned by a package exposing its SDK: ${executable}`);
}

/**
 * Load credential primitives only from the installation owning PI_BIN.
 * No package-name import is used, preventing fallback to another global pi.
 */
export function createPiCredentialService({ config, importSdk = (url) => import(url) } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("config is required");
  const agentDir = config.PI_AGENT_DIR;
  if (typeof agentDir !== "string" || !isAbsolute(agentDir) || resolve(agentDir) !== agentDir) {
    throw capabilityError("validated absolute PI_AGENT_DIR is required for credential support");
  }

  function normalizedProvider(provider) {
    if (typeof provider !== "string" || !provider.trim()) {
      throw credentialError("invalid_provider", "provider is required");
    }
    return provider.trim();
  }

  function reloadOrFail(authStorage) {
    // Initialization errors are intentionally drained only immediately before a
    // fresh reload: malformed storage must fail closed instead of serving the
    // last in-memory snapshot retained by AuthStorage.
    authStorage.drainErrors?.();
    authStorage.reload();
    const errors = authStorage.drainErrors?.() ?? [];
    if (errors.length) {
      throw capabilityError("configured pi auth storage could not be loaded");
    }
  }

  function safeCredential(provider, credential) {
    if (credential?.type === "api_key") return Object.freeze({ provider, credentialType: "api_key" });
    if (credential?.type === "oauth") return Object.freeze({ provider, credentialType: "oauth" });
    throw capabilityError("configured pi auth storage contains an unsupported credential entry");
  }

  function refreshRegistry(modelRegistry) {
    modelRegistry.refresh();
    return new Set(modelRegistry.getAll().map((model) => model.provider).filter(Boolean));
  }

  function safeOAuthProviders(authStorage) {
    if (typeof authStorage.getOAuthProviders !== "function") {
      throw capabilityError("configured pi SDK does not expose OAuth provider discovery");
    }
    const discovered = authStorage.getOAuthProviders();
    if (!Array.isArray(discovered)) {
      throw capabilityError("configured pi SDK returned invalid OAuth provider metadata");
    }
    const providers = new Map();
    for (const item of discovered) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      if (!id || !name) throw capabilityError("configured pi SDK returned invalid OAuth provider metadata");
      providers.set(id, Object.freeze({ id, name }));
    }
    return providers;
  }

  function safeSource(status, credentialType) {
    if (credentialType === "api_key") return "stored_api_key";
    if (credentialType === "oauth") return "stored_oauth";
    if (status?.source === "environment") return "environment";
    if (status?.source === "models_json_key" || status?.source === "models_json_command") return "models_json";
    return "not_configured";
  }

  const activeCredentialProviders = new Set();

  async function withProviderReservation(providerId, operation) {
    if (activeCredentialProviders.has(providerId)) {
      throw credentialError("credential_busy", `provider ${providerId} already has an active credential operation`);
    }
    activeCredentialProviders.add(providerId);
    try {
      return await operation();
    } finally {
      activeCredentialProviders.delete(providerId);
    }
  }

  function normalizedOAuthCallbacks(callbacks) {
    if (!callbacks || typeof callbacks !== "object" || Array.isArray(callbacks)) {
      throw credentialError("invalid_oauth_callbacks", "OAuth callbacks are required");
    }
    for (const name of ["onAuth", "onDeviceCode", "onPrompt", "onSelect"]) {
      if (typeof callbacks[name] !== "function") {
        throw credentialError("invalid_oauth_callbacks", `OAuth callback ${name} is required`);
      }
    }
    for (const name of ["onProgress", "onManualCodeInput"]) {
      if (callbacks[name] !== undefined && typeof callbacks[name] !== "function") {
        throw credentialError("invalid_oauth_callbacks", `OAuth callback ${name} is invalid`);
      }
    }
    return Object.freeze({
      onAuth: callbacks.onAuth,
      onDeviceCode: callbacks.onDeviceCode,
      onPrompt: callbacks.onPrompt,
      onSelect: callbacks.onSelect,
      ...(callbacks.onProgress ? { onProgress: callbacks.onProgress } : {}),
      ...(callbacks.onManualCodeInput ? { onManualCodeInput: callbacks.onManualCodeInput } : {}),
      ...(callbacks.signal ? { signal: callbacks.signal } : {}),
    });
  }

  let adapterPromise;
  async function load() {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const location = resolveConfiguredPiSdk(config.PI_BIN);
        let sdk;
        try {
          sdk = await importSdk(pathToFileURL(location.entry).href);
        } catch (cause) {
          throw capabilityError(`configured pi SDK could not be imported for credential support: ${location.entry}`, cause);
        }
        if (typeof sdk?.AuthStorage?.create !== "function" || typeof sdk?.ModelRegistry?.create !== "function") {
          throw capabilityError(`configured pi SDK does not export AuthStorage and ModelRegistry: ${location.entry}`);
        }

        const authPath = join(agentDir, "auth.json");
        const modelsPath = join(agentDir, "models.json");
        try {
          const authStorage = sdk.AuthStorage.create(authPath);
          const modelRegistry = sdk.ModelRegistry.create(authStorage, modelsPath);
          return Object.freeze({ authStorage, modelRegistry, authPath, modelsPath, sdkEntry: location.entry });
        } catch (cause) {
          throw capabilityError(`configured pi credential storage could not be initialized in PI_AGENT_DIR: ${agentDir}`, cause);
        }
      })();
    }
    return adapterPromise;
  }

  async function listStoredCredentials() {
    const { authStorage } = await load();
    reloadOrFail(authStorage);
    return authStorage.list()
      .sort((left, right) => left.localeCompare(right))
      .map((provider) => safeCredential(provider, authStorage.get(provider)));
  }

  async function listProviders() {
    const { authStorage, modelRegistry } = await load();
    reloadOrFail(authStorage);
    const registered = refreshRegistry(modelRegistry);
    const oauthProviders = safeOAuthProviders(authStorage);
    const providers = new Set([...registered, ...authStorage.list(), ...oauthProviders.keys()]);
    return [...providers]
      .sort((left, right) => left.localeCompare(right))
      .map((provider) => {
        const credential = authStorage.get(provider);
        const credentialType = credential ? safeCredential(provider, credential).credentialType : null;
        const status = modelRegistry.getProviderAuthStatus(provider);
        const oauth = oauthProviders.get(provider);
        return Object.freeze({
          provider,
          displayName: modelRegistry.getProviderDisplayName(provider),
          registered: registered.has(provider),
          oauthCapable: Boolean(oauth),
          oauthDisplayName: oauth?.name ?? null,
          credentialType,
          source: safeSource(status, credentialType),
          configured: credentialType !== null || status?.configured === true,
        });
      });
  }

  async function setApiKey(provider, key) {
    const providerId = normalizedProvider(provider);
    if (typeof key !== "string" || !key) throw credentialError("invalid_key", "API key is required");
    return withProviderReservation(providerId, async () => {
      const { authStorage, modelRegistry } = await load();
      reloadOrFail(authStorage);
      const current = authStorage.get(providerId);
      if (current?.type === "oauth") {
        throw credentialError("oauth_conflict", `provider ${providerId} uses stored OAuth credentials`);
      }
      if (current && current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (!current && !refreshRegistry(modelRegistry).has(providerId)) {
        throw credentialError("unknown_provider", `provider ${providerId} is not registered by the configured pi installation`);
      }
      const env = current?.env ? { ...current.env } : undefined;
      authStorage.set(providerId, { type: "api_key", key, ...(env ? { env } : {}) });
      return Object.freeze({ provider: providerId, credentialType: "api_key" });
    });
  }

  async function removeApiKey(provider) {
    const providerId = normalizedProvider(provider);
    return withProviderReservation(providerId, async () => {
      const { authStorage } = await load();
      reloadOrFail(authStorage);
      const current = authStorage.get(providerId);
      if (current?.type === "oauth") {
        throw credentialError("oauth_conflict", `provider ${providerId} uses stored OAuth credentials`);
      }
      if (!current) throw credentialError("credential_not_found", `provider ${providerId} has no stored API key`);
      if (current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      authStorage.remove(providerId);
      return Object.freeze({ provider: providerId, removed: true });
    });
  }

  async function loginOAuth(provider, callbacks, { replace = false } = {}) {
    const providerId = normalizedProvider(provider);
    const safeCallbacks = normalizedOAuthCallbacks(callbacks);
    return withProviderReservation(providerId, async () => {
      const { authStorage } = await load();
      reloadOrFail(authStorage);
      if (!safeOAuthProviders(authStorage).has(providerId)) {
        throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth in the configured pi installation`);
      }
      const current = authStorage.get(providerId);
      if (current && current.type !== "oauth" && current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (current && replace !== true) {
        throw credentialError("credential_replace_required", `provider ${providerId} already has stored credentials`);
      }
      await authStorage.login(providerId, safeCallbacks);
      return Object.freeze({ provider: providerId, credentialType: "oauth" });
    });
  }

  async function logoutOAuth(provider) {
    const providerId = normalizedProvider(provider);
    return withProviderReservation(providerId, async () => {
      const { authStorage } = await load();
      reloadOrFail(authStorage);
      const current = authStorage.get(providerId);
      if (!current) throw credentialError("credential_not_found", `provider ${providerId} has no stored OAuth credential`);
      if (current.type !== "oauth") {
        if (current.type === "api_key") {
          throw credentialError("credential_type_conflict", `provider ${providerId} uses a stored API key`);
        }
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      authStorage.logout(providerId);
      return Object.freeze({ provider: providerId, removed: true });
    });
  }

  return Object.freeze({ load, listStoredCredentials, listProviders, setApiKey, removeApiKey, loginOAuth, logoutOAuth });
}
