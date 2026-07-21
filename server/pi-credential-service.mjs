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

  function reloadOrFail(authStorage, authPath, modern = false) {
    // Modern AuthStorage deliberately retains its last valid snapshot when a
    // reload fails. Validate the file first so Oyster still fails closed.
    if (modern && existsSync(authPath)) {
      try {
        const value = JSON.parse(readFileSync(authPath, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid credential root");
      } catch {
        throw capabilityError("configured pi auth storage could not be loaded");
      }
    }
    authStorage.drainErrors?.();
    authStorage.reload();
    const errors = authStorage.drainErrors?.() ?? [];
    if (errors.length) throw capabilityError("configured pi auth storage could not be loaded");
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

  function runtimeOAuthProviders(modelRuntime) {
    const providers = new Map();
    for (const provider of modelRuntime.getProviders()) {
      const id = typeof provider?.id === "string" ? provider.id.trim() : "";
      const name = typeof provider?.auth?.oauth?.name === "string" ? provider.auth.oauth.name.trim() : "";
      if (id && name) providers.set(id, Object.freeze({ id, name }));
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

  function runtimeOAuthInteraction(callbacks) {
    return Object.freeze({
      ...(callbacks.signal ? { signal: callbacks.signal } : {}),
      notify(event) {
        if (event?.type === "auth_url") callbacks.onAuth({ url: event.url, instructions: event.instructions });
        else if (event?.type === "device_code") callbacks.onDeviceCode({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
        else if (event?.type === "progress" || event?.type === "info") callbacks.onProgress?.(event.message);
      },
      prompt(prompt) {
        if (prompt?.type === "select") return callbacks.onSelect(prompt);
        if (prompt?.type === "manual_code" && callbacks.onManualCodeInput) return callbacks.onManualCodeInput(prompt);
        return callbacks.onPrompt(prompt);
      },
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

        const authPath = join(agentDir, "auth.json");
        const modelsPath = join(agentDir, "models.json");
        try {
          if (typeof sdk?.AuthStorage?.create === "function" && typeof sdk?.ModelRegistry?.create === "function") {
            const authStorage = sdk.AuthStorage.create(authPath);
            const modelRegistry = sdk.ModelRegistry.create(authStorage, modelsPath);
            return Object.freeze({ kind: "legacy", authStorage, modelRegistry, authPath, modelsPath, sdkEntry: location.entry });
          }
          if (typeof sdk?.ModelRuntime?.create === "function" && typeof sdk?.readStoredCredential === "function") {
            const authEntry = resolve(dirname(location.entry), "core", "auth-storage.js");
            if (!authEntry.startsWith(`${location.packageRoot}/`) || !existsSync(authEntry)) {
              throw capabilityError(`configured pi SDK does not expose its credential store: ${location.entry}`);
            }
            const authSdk = await importSdk(pathToFileURL(authEntry).href);
            if (typeof authSdk?.AuthStorage?.create !== "function") {
              throw capabilityError(`configured pi SDK does not expose its credential store: ${authEntry}`);
            }
            const authStorage = authSdk.AuthStorage.create(authPath);
            const modelRuntime = await sdk.ModelRuntime.create({ credentials: authStorage, modelsPath, allowModelNetwork: false });
            return Object.freeze({ kind: "runtime", authStorage, modelRuntime, sdk, authPath, modelsPath, sdkEntry: location.entry });
          }
          throw capabilityError(`configured pi SDK does not expose supported credential APIs: ${location.entry}`);
        } catch (cause) {
          if (cause?.code === CAPABILITY_ERROR) throw cause;
          throw capabilityError(`configured pi credential storage could not be initialized in PI_AGENT_DIR: ${agentDir}`, cause);
        }
      })();
    }
    return adapterPromise;
  }

  async function prepare(adapter) {
    reloadOrFail(adapter.authStorage, adapter.authPath, adapter.kind === "runtime");
  }

  async function credentialEntries(adapter) {
    if (adapter.kind === "runtime") return adapter.authStorage.list();
    return adapter.authStorage.list().map((providerId) => ({ providerId, type: adapter.authStorage.get(providerId)?.type }));
  }

  function storedCredential(adapter, provider) {
    return adapter.kind === "runtime"
      ? adapter.sdk.readStoredCredential(provider, adapter.authPath)
      : adapter.authStorage.get(provider);
  }

  function registeredProviders(adapter) {
    return adapter.kind === "runtime"
      ? new Set(adapter.modelRuntime.getProviders().map((provider) => provider.id))
      : refreshRegistry(adapter.modelRegistry);
  }

  function providerMetadata(adapter) {
    if (adapter.kind === "runtime") {
      return {
        registered: registeredProviders(adapter),
        oauthProviders: runtimeOAuthProviders(adapter.modelRuntime),
        status: (provider) => adapter.modelRuntime.getProviderAuthStatus(provider),
        displayName: (provider) => adapter.modelRuntime.getProvider(provider)?.name ?? provider,
      };
    }
    return {
      registered: registeredProviders(adapter),
      oauthProviders: safeOAuthProviders(adapter.authStorage),
      status: (provider) => adapter.modelRegistry.getProviderAuthStatus(provider),
      displayName: (provider) => adapter.modelRegistry.getProviderDisplayName(provider),
    };
  }

  async function listStoredCredentials() {
    const adapter = await load();
    await prepare(adapter);
    const entries = await credentialEntries(adapter);
    return entries
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map(({ providerId, type }) => safeCredential(providerId, { type }));
  }

  async function listProviders() {
    const adapter = await load();
    await prepare(adapter);
    const entries = await credentialEntries(adapter);
    const credentials = new Map(entries.map(({ providerId, type }) => [providerId, type]));
    const metadata = providerMetadata(adapter);
    const providers = new Set([...metadata.registered, ...credentials.keys(), ...metadata.oauthProviders.keys()]);
    return [...providers]
      .sort((left, right) => left.localeCompare(right))
      .map((provider) => {
        const type = credentials.get(provider);
        const credentialType = type ? safeCredential(provider, { type }).credentialType : null;
        const status = metadata.status(provider);
        const oauth = metadata.oauthProviders.get(provider);
        return Object.freeze({
          provider,
          displayName: metadata.displayName(provider),
          registered: metadata.registered.has(provider),
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
      const adapter = await load();
      await prepare(adapter);
      const current = storedCredential(adapter, providerId);
      if (current?.type === "oauth") {
        throw credentialError("oauth_conflict", `provider ${providerId} uses stored OAuth credentials`);
      }
      if (current && current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (!current && !registeredProviders(adapter).has(providerId)) {
        throw credentialError("unknown_provider", `provider ${providerId} is not registered by the configured pi installation`);
      }
      const env = current?.env ? { ...current.env } : undefined;
      const credential = { type: "api_key", key, ...(env ? { env } : {}) };
      if (adapter.kind === "runtime") await adapter.authStorage.modify(providerId, async () => credential);
      else adapter.authStorage.set(providerId, credential);
      return Object.freeze({ provider: providerId, credentialType: "api_key" });
    });
  }

  async function removeApiKey(provider) {
    const providerId = normalizedProvider(provider);
    return withProviderReservation(providerId, async () => {
      const adapter = await load();
      await prepare(adapter);
      const current = storedCredential(adapter, providerId);
      if (current?.type === "oauth") {
        throw credentialError("oauth_conflict", `provider ${providerId} uses stored OAuth credentials`);
      }
      if (!current) throw credentialError("credential_not_found", `provider ${providerId} has no stored API key`);
      if (current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (adapter.kind === "runtime") await adapter.authStorage.delete(providerId);
      else adapter.authStorage.remove(providerId);
      return Object.freeze({ provider: providerId, removed: true });
    });
  }

  async function loginOAuth(provider, callbacks, { replace = false } = {}) {
    const providerId = normalizedProvider(provider);
    const safeCallbacks = normalizedOAuthCallbacks(callbacks);
    return withProviderReservation(providerId, async () => {
      const adapter = await load();
      await prepare(adapter);
      const oauthProviders = adapter.kind === "runtime"
        ? runtimeOAuthProviders(adapter.modelRuntime)
        : safeOAuthProviders(adapter.authStorage);
      if (!oauthProviders.has(providerId)) {
        throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth in the configured pi installation`);
      }
      const current = storedCredential(adapter, providerId);
      if (current && current.type !== "oauth" && current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (current && replace !== true) {
        throw credentialError("credential_replace_required", `provider ${providerId} already has stored credentials`);
      }
      if (adapter.kind === "runtime") {
        await adapter.modelRuntime.login(providerId, "oauth", runtimeOAuthInteraction(safeCallbacks));
      } else {
        await adapter.authStorage.login(providerId, safeCallbacks);
      }
      return Object.freeze({ provider: providerId, credentialType: "oauth" });
    });
  }

  async function logoutOAuth(provider) {
    const providerId = normalizedProvider(provider);
    return withProviderReservation(providerId, async () => {
      const adapter = await load();
      await prepare(adapter);
      const current = storedCredential(adapter, providerId);
      if (!current) throw credentialError("credential_not_found", `provider ${providerId} has no stored OAuth credential`);
      if (current.type !== "oauth") {
        if (current.type === "api_key") {
          throw credentialError("credential_type_conflict", `provider ${providerId} uses a stored API key`);
        }
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (adapter.kind === "runtime") await adapter.modelRuntime.logout(providerId);
      else adapter.authStorage.logout(providerId);
      return Object.freeze({ provider: providerId, removed: true });
    });
  }

  return Object.freeze({ load, listStoredCredentials, listProviders, setApiKey, removeApiKey, loginOAuth, logoutOAuth });
}
