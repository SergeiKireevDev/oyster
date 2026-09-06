import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { refreshAnthropicOAuthGrant } from "./claude-oauth-credential-sink.mjs";

const CAPABILITY_ERROR = "credential_service_unavailable";
const ANTHROPIC = "anthropic";
const OPENAI_CODEX = "openai-codex";
const GEMINI_CLI = "google-gemini-cli";
const AMP = "amp";
const DEFAULT_ROTATION_MARGIN_MS = 30 * 60 * 1000;

function credentialError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function capabilityError(message, cause) {
  return credentialError(CAPABILITY_ERROR, message, cause);
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function exportedEntryTarget(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportedEntryTarget(candidate);
      if (target) return target;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  // Node resolves conditional exports in declaration order. `node`,
  // `node-addons`, and `import` are active; `default` is the fallback.
  for (const [condition, candidate] of Object.entries(value)) {
    if (condition !== "import" && condition !== "node" && condition !== "node-addons" && condition !== "default") continue;
    const target = exportedEntryTarget(candidate);
    if (target) return target;
  }
  return null;
}

function rootExport(exports) {
  if (typeof exports === "string" || Array.isArray(exports)) return exports;
  if (!exports || typeof exports !== "object") return null;
  if (Object.hasOwn(exports, ".")) return exports["."];
  // An exports object with no subpath keys is conditional sugar for ".".
  return Object.keys(exports).some((key) => key.startsWith(".")) ? null : exports;
}

function packageEntry(packageRoot, manifest) {
  const exported = exportedEntryTarget(rootExport(manifest.exports));
  const target = exported ?? manifest.main;
  if (typeof target !== "string" || !target.trim()) return null;
  const entry = resolve(packageRoot, target);
  return isWithin(packageRoot, entry) ? entry : null;
}

function declaredBins(packageRoot, manifest) {
  const values = typeof manifest.bin === "string"
    ? [manifest.bin]
    : manifest.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin)
      ? Object.values(manifest.bin)
      : [];
  return values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => resolve(packageRoot, value))
    .filter((value) => isWithin(packageRoot, value));
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
        const realEntry = realpathSync(entry);
        if (!isWithin(directory, realEntry)) {
          throw capabilityError(`configured pi package SDK entry escapes its package root: ${manifestPath}`);
        }
        return Object.freeze({ executable, packageRoot: directory, manifestPath, entry: realEntry });
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
export function createPiCredentialService({
  config,
  importSdk = (url) => import(url),
  claudeOAuthCredentialSink = null,
  codexOAuthCredentialSink = null,
  geminiOAuthCredentialSink = null,
  ampOAuthCredentialSink = null,
} = {}) {
  if (!config || typeof config !== "object") throw new TypeError("config is required");
  if (claudeOAuthCredentialSink !== null
    && (typeof claudeOAuthCredentialSink?.status !== "function"
      || typeof claudeOAuthCredentialSink?.project !== "function"
      || typeof claudeOAuthCredentialSink?.remove !== "function")) {
    throw new TypeError("claudeOAuthCredentialSink must expose status, project, and remove functions");
  }
  if (codexOAuthCredentialSink !== null
    && (typeof codexOAuthCredentialSink?.status !== "function"
      || typeof codexOAuthCredentialSink?.project !== "function"
      || typeof codexOAuthCredentialSink?.remove !== "function")) {
    throw new TypeError("codexOAuthCredentialSink must expose status, project, and remove functions");
  }
  if (geminiOAuthCredentialSink !== null
    && (typeof geminiOAuthCredentialSink?.status !== "function"
      || typeof geminiOAuthCredentialSink?.login !== "function"
      || typeof geminiOAuthCredentialSink?.remove !== "function")) {
    throw new TypeError("geminiOAuthCredentialSink must expose status, login, and remove functions");
  }
  if (ampOAuthCredentialSink !== null
    && (typeof ampOAuthCredentialSink?.status !== "function"
      || typeof ampOAuthCredentialSink?.login !== "function"
      || typeof ampOAuthCredentialSink?.remove !== "function")) {
    throw new TypeError("ampOAuthCredentialSink must expose status, login, and remove functions");
  }
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

  function normalizedHarness(harness = "pi") {
    if (!new Set(["pi", "claude-code", "gemini", "amp"]).has(harness)) {
      throw credentialError("invalid_harness", "supported harness is required");
    }
    if (harness === "claude-code" && !claudeOAuthCredentialSink) throw credentialError("oauth_provider_not_found", "Claude Code OAuth is not configured");
    if (harness === "gemini" && !geminiOAuthCredentialSink) throw credentialError("oauth_provider_not_found", "Gemini CLI OAuth is not configured");
    if (harness === "amp" && !ampOAuthCredentialSink) throw credentialError("oauth_provider_not_found", "Amp login is not configured");
    return harness;
  }

  function reloadOrFail(authStorage, authPath, modern = false) {
    // Modern AuthStorage deliberately retains its last valid snapshot when a
    // reload fails. Validate the file first so Oyster still fails closed.
    if (modern && existsSync(authPath)) {
      try {
        const content = readFileSync(authPath, "utf8");
        const value = content.trim() ? JSON.parse(content) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid credential root");
      } catch {
        throw capabilityError("configured pi auth storage could not be loaded");
      }
    }
    try {
      authStorage.drainErrors?.();
      authStorage.reload();
      const errors = authStorage.drainErrors?.() ?? [];
      if (!Array.isArray(errors) || errors.length) {
        throw capabilityError("configured pi auth storage could not be loaded");
      }
    } catch (cause) {
      if (cause?.code === CAPABILITY_ERROR) throw cause;
      throw capabilityError("configured pi auth storage could not be loaded", cause);
    }
  }

  function safeProviderId(value, source) {
    const provider = typeof value === "string" ? value.trim() : "";
    if (!provider || provider !== value) {
      throw capabilityError(`configured pi SDK returned invalid ${source} provider metadata`);
    }
    return provider;
  }

  function safeCredential(provider, credential) {
    const providerId = safeProviderId(provider, "credential");
    if (credential?.type === "api_key") return Object.freeze({ provider: providerId, credentialType: "api_key" });
    if (credential?.type === "oauth") return Object.freeze({ provider: providerId, credentialType: "oauth" });
    throw capabilityError("configured pi auth storage contains an unsupported credential entry");
  }

  function safeRegisteredProviders(providers) {
    if (!Array.isArray(providers)) throw capabilityError("configured pi SDK returned invalid model provider metadata");
    return new Set(providers.map((provider) => safeProviderId(provider?.id ?? provider, "model")));
  }

  function refreshRegistry(modelRegistry) {
    modelRegistry.refresh();
    const models = modelRegistry.getAll();
    if (!Array.isArray(models)) throw capabilityError("configured pi SDK returned invalid model provider metadata");
    return new Set(models.map((model) => safeProviderId(model?.provider, "model")));
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
      const id = safeProviderId(item?.id, "OAuth");
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      if (!name || providers.has(id)) throw capabilityError("configured pi SDK returned invalid OAuth provider metadata");
      providers.set(id, Object.freeze({ id, name }));
    }
    return providers;
  }

  function runtimeOAuthProviders(modelRuntime) {
    const discovered = modelRuntime.getProviders();
    if (!Array.isArray(discovered)) throw capabilityError("configured pi SDK returned invalid model provider metadata");
    const providers = new Map();
    for (const provider of discovered) {
      const id = safeProviderId(provider?.id, "model");
      if (provider?.auth?.oauth === undefined) continue;
      const name = typeof provider.auth.oauth?.name === "string" ? provider.auth.oauth.name.trim() : "";
      if (!name || providers.has(id)) throw capabilityError("configured pi SDK returned invalid OAuth provider metadata");
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

  async function withProviderReservation(providerId, harness, operation) {
    const reservation = `${harness}:${providerId}`;
    if (activeCredentialProviders.has(reservation)) {
      throw credentialError("credential_busy", `provider ${providerId} already has an active credential operation for ${harness}`);
    }
    activeCredentialProviders.add(reservation);
    try {
      return await operation();
    } finally {
      activeCredentialProviders.delete(reservation);
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
    if (callbacks.signal !== undefined && callbacks.signal !== null
      && (typeof callbacks.signal !== "object" || typeof callbacks.signal.aborted !== "boolean"
        || typeof callbacks.signal.addEventListener !== "function")) {
      throw credentialError("invalid_oauth_callbacks", "OAuth callback signal is invalid");
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
            const unresolvedAuthEntry = resolve(dirname(location.entry), "core", "auth-storage.js");
            let authEntry;
            try {
              authEntry = realpathSync(unresolvedAuthEntry);
            } catch (cause) {
              throw capabilityError(`configured pi SDK does not expose its credential store: ${location.entry}`, cause);
            }
            if (!isWithin(location.packageRoot, authEntry)) {
              throw capabilityError(`configured pi SDK credential store escapes its package root: ${unresolvedAuthEntry}`);
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
    const pending = adapterPromise;
    try {
      return await pending;
    } catch (error) {
      // Import and initialization failures can be transient (for example,
      // during an atomic package replacement). Keep concurrent callers on the
      // same attempt, but allow a later request to retry.
      if (adapterPromise === pending) adapterPromise = undefined;
      throw error;
    }
  }

  async function prepare(adapter) {
    reloadOrFail(adapter.authStorage, adapter.authPath, adapter.kind === "runtime");
  }

  async function credentialEntries(adapter) {
    const listed = await adapter.authStorage.list();
    if (!Array.isArray(listed)) throw capabilityError("configured pi auth storage returned invalid credential metadata");
    const entries = adapter.kind === "runtime"
      ? listed
      : listed.map((providerId) => ({ providerId, type: adapter.authStorage.get(providerId)?.type }));
    const seen = new Set();
    return entries.map((entry) => {
      const providerId = safeProviderId(entry?.providerId, "credential");
      if (seen.has(providerId)) throw capabilityError("configured pi auth storage returned duplicate credential metadata");
      seen.add(providerId);
      const credential = safeCredential(providerId, { type: entry?.type });
      return { providerId, type: credential.credentialType };
    });
  }

  function storedCredential(adapter, provider) {
    return adapter.kind === "runtime"
      ? adapter.sdk.readStoredCredential(provider, adapter.authPath)
      : adapter.authStorage.get(provider);
  }

  /** Persist an OAuth credential through pi's own locked store when it offers one. */
  async function writeStoredOAuth(adapter, provider, credential) {
    const value = { type: "oauth", access: credential.access, refresh: credential.refresh, expires: credential.expires,
      ...(Number.isFinite(credential.refreshExpires) ? { refreshExpires: credential.refreshExpires } : {}) };
    if (typeof adapter.authStorage.modify === "function") {
      await adapter.authStorage.modify(provider, async () => value);
    } else if (typeof adapter.authStorage.set === "function") {
      adapter.authStorage.set(provider, value);
    } else {
      throw capabilityError("configured pi auth storage cannot store an OAuth credential");
    }
  }

  function projectToClaude(credential, { fatal = false } = {}) {
    try {
      claudeOAuthCredentialSink.project({ ...credential, type: "oauth" });
      return true;
    } catch (error) {
      if (fatal) throw error;
      console.warn(`[oyster] Claude Code credential store was not updated: ${error?.message ?? error}`);
      return false;
    }
  }

  /**
   * pi's `auth.json` and Claude Code's `.credentials.json` share one Anthropic
   * grant. Whichever store holds the fresher token wins and is mirrored to the
   * other; a pi API key is never replaced by an OAuth grant.
   */
  async function syncAnthropicOAuth(adapter) {
    if (!claudeOAuthCredentialSink) return Object.freeze({ outcome: "unavailable" });
    const pi = storedCredential(adapter, ANTHROPIC);
    if (pi && pi.type !== "oauth") return Object.freeze({ outcome: "skipped", reason: "pi_api_key" });
    const claude = claudeOAuthCredentialSink.read();
    if (!pi && !claude) return Object.freeze({ outcome: "unchanged", source: null });
    if (pi && claude && pi.refresh === claude.refresh && pi.expires === claude.expires) {
      return Object.freeze({ outcome: "unchanged", source: null, expiresAt: pi.expires });
    }
    if (!pi || (claude && claude.expires > pi.expires)) {
      await writeStoredOAuth(adapter, ANTHROPIC, claude);
      return Object.freeze({ outcome: "synced", source: "claude", expiresAt: claude.expires });
    }
    if (!projectToClaude(pi)) return Object.freeze({ outcome: "failed", source: "pi", expiresAt: pi.expires });
    return Object.freeze({ outcome: "synced", source: "pi", expiresAt: pi.expires });
  }

  let deadRefreshToken = null;

  /**
   * Rotate the shared Anthropic grant ahead of expiry. The exchange runs inside
   * pi's `modify()` lock, which re-reads the file first, so pi runners and this
   * process can never spend the single-use refresh token twice.
   */
  async function rotateAnthropicOAuth({
    marginMs = DEFAULT_ROTATION_MARGIN_MS, force = false, reason = "manual",
    fetchImpl = undefined, now = Date.now, refreshGrant = refreshAnthropicOAuthGrant,
  } = {}) {
    if (!claudeOAuthCredentialSink) return Object.freeze({ outcome: "unavailable", reason });
    const perform = async () => {
      const adapter = await load();
      await prepare(adapter);
      await syncAnthropicOAuth(adapter);
      const pi = storedCredential(adapter, ANTHROPIC);
      if (pi?.type === "api_key") return rotateStandalone({ marginMs, force, reason, fetchImpl, now, refreshGrant });
      const credential = pi?.type === "oauth" ? pi : null; // sync already mirrored a Claude-only grant into pi
      if (!credential) return Object.freeze({ outcome: "not_configured", reason });
      if (!force && credential.expires - now() > marginMs) return Object.freeze({ outcome: "not_needed", reason, expiresAt: credential.expires });
      if (deadRefreshToken !== null && credential.refresh === deadRefreshToken) {
        return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
      }
      const exchange = (stored) => refreshGrant(stored.refresh, fetchImpl ? { fetchImpl, now } : { now });
      try {
        if (typeof adapter.authStorage.modify === "function") {
          await adapter.authStorage.modify(ANTHROPIC, async (stored) => {
            if (stored?.type !== "oauth") return undefined;
            if (!force && stored.expires - now() > marginMs) return undefined; // refreshed meanwhile
            return await exchange(stored);
          });
        } else {
          await writeStoredOAuth(adapter, ANTHROPIC, await exchange(credential));
        }
      } catch (error) {
        const cause = error?.invalidGrant ? error : error?.cause?.invalidGrant ? error.cause : null;
        if (cause) {
          deadRefreshToken = credential.refresh;
          return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires, error: cause.message });
        }
        return Object.freeze({ outcome: "failed", reason, expiresAt: credential.expires, error: error?.message ?? String(error) });
      }
      deadRefreshToken = null;
      const latest = storedCredential(adapter, ANTHROPIC);
      if (latest?.type !== "oauth") return Object.freeze({ outcome: "not_configured", reason });
      projectToClaude(latest);
      return Object.freeze({
        outcome: "refreshed", reason, rotated: latest.refresh !== credential.refresh,
        expiresAt: latest.expires, refreshTokenExpiresAt: Number.isFinite(latest.refreshExpires) ? latest.refreshExpires : null,
      });
    };
    return withProviderReservation(ANTHROPIC, "pi", () => withProviderReservation(ANTHROPIC, "claude-code", perform));
  }

  /** pi keeps an API key, so Claude Code's grant is its own and rotates through the sink. */
  async function rotateStandalone({ marginMs, force, reason, fetchImpl, now, refreshGrant }) {
    const claude = claudeOAuthCredentialSink.read();
    if (!claude) return Object.freeze({ outcome: "not_configured", reason });
    if (!force && claude.expires - now() > marginMs) return Object.freeze({ outcome: "not_needed", reason, expiresAt: claude.expires });
    if (deadRefreshToken !== null && claude.refresh === deadRefreshToken) return Object.freeze({ outcome: "reauth_required", reason, expiresAt: claude.expires });
    let next;
    try {
      next = await refreshGrant(claude.refresh, fetchImpl ? { fetchImpl, now } : { now });
    } catch (error) {
      if (error?.invalidGrant) { deadRefreshToken = claude.refresh; return Object.freeze({ outcome: "reauth_required", reason, expiresAt: claude.expires, error: error.message }); }
      return Object.freeze({ outcome: "failed", reason, expiresAt: claude.expires, error: error?.message ?? String(error) });
    }
    deadRefreshToken = null;
    const current = claudeOAuthCredentialSink.read();
    if (current && current.refresh !== claude.refresh) {
      return Object.freeze({ outcome: "refreshed", reason, rotated: false, expiresAt: current.expires, refreshTokenExpiresAt: current.refreshExpires });
    }
    projectToClaude(next, { fatal: true });
    return Object.freeze({ outcome: "refreshed", reason, rotated: true, expiresAt: next.expires, refreshTokenExpiresAt: next.refreshExpires });
  }

  const deadProviderRefreshTokens = new Map();

  /** Rotate a pi-owned OAuth grant for another compatible harness. */
  async function rotateProviderOAuth(provider, {
    marginMs = DEFAULT_ROTATION_MARGIN_MS, force = false, reason = "manual", now = Date.now,
  } = {}) {
    const providerId = normalizedProvider(provider);
    return withProviderReservation(providerId, "pi", async () => {
      const adapter = await load();
      await prepare(adapter);
      const credential = storedCredential(adapter, providerId);
      if (credential?.type !== "oauth") return Object.freeze({ outcome: "not_configured", reason });
      if (!force && credential.expires - now() > marginMs) {
        if (providerId === OPENAI_CODEX && codexOAuthCredentialSink) codexOAuthCredentialSink.project(credential);
        return Object.freeze({ outcome: "not_needed", reason, expiresAt: credential.expires });
      }
      if (deadProviderRefreshTokens.get(providerId) === credential.refresh) {
        return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
      }
      const oauth = adapter.kind === "runtime"
        ? adapter.modelRuntime.getProvider(providerId)?.auth?.oauth
        : adapter.authStorage.getOAuthProviders().find((candidate) => candidate?.id === providerId);
      if (typeof oauth?.refresh !== "function") return Object.freeze({ outcome: "failed", reason, expiresAt: credential.expires, error: "OAuth refresh is unavailable" });
      try {
        if (typeof adapter.authStorage.modify === "function") {
          await adapter.authStorage.modify(providerId, async (stored) => {
            if (stored?.type !== "oauth") return undefined;
            if (!force && stored.expires - now() > marginMs) return undefined;
            return oauth.refresh(stored);
          });
        } else {
          await writeStoredOAuth(adapter, providerId, await oauth.refresh(credential));
        }
      } catch (error) {
        const message = error?.message ?? String(error);
        if (/invalid_grant|refresh token.*(?:expired|invalid|revoked|reused)/i.test(message)) {
          deadProviderRefreshTokens.set(providerId, credential.refresh);
          return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
        }
        return Object.freeze({ outcome: "failed", reason, expiresAt: credential.expires, error: message });
      }
      deadProviderRefreshTokens.delete(providerId);
      const latest = storedCredential(adapter, providerId);
      if (latest?.type !== "oauth") return Object.freeze({ outcome: "not_configured", reason });
      if (providerId === OPENAI_CODEX && codexOAuthCredentialSink) codexOAuthCredentialSink.project(latest);
      return Object.freeze({
        outcome: "refreshed", reason, rotated: latest.refresh !== credential.refresh,
        expiresAt: latest.expires, refreshTokenExpiresAt: Number.isFinite(latest.refreshExpires) ? latest.refreshExpires : null,
      });
    });
  }

  function registeredProviders(adapter) {
    return adapter.kind === "runtime"
      ? safeRegisteredProviders(adapter.modelRuntime.getProviders())
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
    // Native harnesses share compatible pi-owned grants; a pi API key cannot
    // be projected as a subscription OAuth connection.
    const sharedAnthropic = Boolean(claudeOAuthCredentialSink) && metadata.oauthProviders.has(ANTHROPIC)
      && credentials.get(ANTHROPIC) !== "api_key";
    const sharedOpenAI = Boolean(codexOAuthCredentialSink) && metadata.oauthProviders.has(OPENAI_CODEX)
      && credentials.get(OPENAI_CODEX) !== "api_key";
    const result = [...providers]
      .sort((left, right) => left.localeCompare(right))
      .map((provider) => {
        const type = credentials.get(provider);
        const credentialType = type ? safeCredential(provider, { type }).credentialType : null;
        const status = metadata.status(provider);
        const oauth = metadata.oauthProviders.get(provider);
        return Object.freeze({
          provider,
          displayName: (() => {
            const displayName = metadata.displayName(provider);
            return typeof displayName === "string" && displayName.trim() ? displayName.trim() : provider;
          })(),
          registered: metadata.registered.has(provider),
          oauthCapable: Boolean(oauth),
          oauthDisplayName: oauth?.name ?? null,
          credentialType,
          source: safeSource(status, credentialType),
          configured: credentialType !== null || status?.configured === true,
          ...(sharedAnthropic && provider === ANTHROPIC ? { harnesses: Object.freeze(["pi", "claude-code"]) } : {}),
          ...(sharedOpenAI && provider === OPENAI_CODEX ? { harnesses: Object.freeze(["pi", "codex"]) } : {}),
        });
      });
    if (claudeOAuthCredentialSink && metadata.oauthProviders.has(ANTHROPIC) && !sharedAnthropic) {
      const status = claudeOAuthCredentialSink.status();
      result.push(Object.freeze({
        provider: ANTHROPIC,
        harness: "claude-code",
        displayName: "Anthropic",
        registered: true,
        oauthCapable: true,
        oauthDisplayName: "Anthropic (Claude Code)",
        credentialType: status.configured ? "oauth" : null,
        source: status.configured ? "stored_oauth" : "not_configured",
        configured: status.configured,
      }));
    }
    if (geminiOAuthCredentialSink) {
      const status = geminiOAuthCredentialSink.status();
      result.push(Object.freeze({
        provider: GEMINI_CLI, harness: "gemini", displayName: "Google Gemini CLI",
        registered: true, oauthCapable: true, oauthDisplayName: "Google account",
        credentialType: status.configured ? "oauth" : null,
        source: status.configured ? "stored_oauth" : "not_configured", configured: status.configured,
      }));
    }
    if (ampOAuthCredentialSink) {
      const status = ampOAuthCredentialSink.status();
      result.push(Object.freeze({
        provider: AMP, harness: "amp", displayName: "Amp",
        registered: true, oauthCapable: true, oauthDisplayName: "Amp account",
        credentialType: status.configured ? "oauth" : null,
        source: status.configured ? "stored_oauth" : "not_configured", configured: status.configured,
      }));
    }
    return result;
  }

  async function setApiKey(provider, key) {
    const providerId = normalizedProvider(provider);
    if (typeof key !== "string" || !key) throw credentialError("invalid_key", "API key is required");
    return withProviderReservation(providerId, "pi", async () => {
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
    return withProviderReservation(providerId, "pi", async () => {
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

  async function loginOAuth(provider, callbacks, { replace = false, harness = "pi" } = {}) {
    const providerId = normalizedProvider(provider);
    const harnessId = normalizedHarness(harness);
    const safeCallbacks = normalizedOAuthCallbacks(callbacks);
    return withProviderReservation(providerId, harnessId, async () => {
      if (harnessId === "gemini") {
        if (providerId !== GEMINI_CLI) throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth for Gemini CLI`);
        if (geminiOAuthCredentialSink.status().configured && replace !== true) throw credentialError("credential_replace_required", "Gemini CLI already has stored Google OAuth credentials");
        await geminiOAuthCredentialSink.login(safeCallbacks);
        return Object.freeze({ provider: providerId, harness: harnessId, credentialType: "oauth", harnesses: Object.freeze(["gemini"]) });
      }
      if (harnessId === "amp") {
        if (providerId !== AMP) throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support login for Amp`);
        if (ampOAuthCredentialSink.status().configured && replace !== true) throw credentialError("credential_replace_required", "Amp already has stored credentials");
        await ampOAuthCredentialSink.login(safeCallbacks);
        return Object.freeze({ provider: providerId, harness: harnessId, credentialType: "oauth", harnesses: Object.freeze(["amp"]) });
      }
      const adapter = await load();
      await prepare(adapter);
      const oauthProviders = adapter.kind === "runtime"
        ? runtimeOAuthProviders(adapter.modelRuntime)
        : safeOAuthProviders(adapter.authStorage);
      if (!oauthProviders.has(providerId) || (harnessId === "claude-code" && providerId !== "anthropic")) {
        throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth for ${harnessId}`);
      }

      const piLogin = async () => {
        if (adapter.kind === "runtime") await adapter.modelRuntime.login(providerId, "oauth", runtimeOAuthInteraction(safeCallbacks));
        else await adapter.authStorage.login(providerId, safeCallbacks);
      };

      if (harnessId === "claude-code") {
        const current = claudeOAuthCredentialSink.status();
        if (current.configured && replace !== true) {
          throw credentialError("credential_replace_required", "Claude Code already has stored Anthropic OAuth credentials");
        }
        const piStored = storedCredential(adapter, providerId);
        if (piStored?.type === "api_key") {
          // pi keeps its API key; Claude Code gets a grant of its own.
          let credential;
          if (adapter.kind === "runtime") {
            const oauth = adapter.modelRuntime.getProvider(providerId)?.auth?.oauth;
            if (typeof oauth?.login !== "function") throw capabilityError("configured pi SDK does not expose Anthropic OAuth login");
            credential = await oauth.login(runtimeOAuthInteraction(safeCallbacks));
          } else {
            const oauth = adapter.authStorage.getOAuthProviders().find((candidate) => candidate?.id === providerId);
            if (typeof oauth?.login !== "function") throw capabilityError("configured pi SDK does not expose Anthropic OAuth login");
            credential = await oauth.login(safeCallbacks);
          }
          projectToClaude(credential, { fatal: true });
          return Object.freeze({ provider: providerId, harness: harnessId, credentialType: "oauth", harnesses: Object.freeze(["claude-code"]) });
        }
        // Claude Code shares pi's grant: link the stored one, or establish it once for both.
        if (piStored?.type !== "oauth") await piLogin();
        const shared = storedCredential(adapter, providerId);
        if (shared?.type !== "oauth") throw capabilityError("configured pi auth storage did not store the Anthropic OAuth grant");
        projectToClaude(shared, { fatal: true });
        return Object.freeze({ provider: providerId, harness: harnessId, credentialType: "oauth", harnesses: Object.freeze(["pi", "claude-code"]) });
      }

      const current = storedCredential(adapter, providerId);
      if (current && current.type !== "oauth" && current.type !== "api_key") {
        throw capabilityError("configured pi auth storage contains an unsupported credential entry");
      }
      if (current && replace !== true) {
        throw credentialError("credential_replace_required", `provider ${providerId} already has stored credentials`);
      }
      await piLogin();
      let sharedWithClaude = false;
      let sharedWithCodex = false;
      const shared = storedCredential(adapter, providerId);
      if (claudeOAuthCredentialSink && providerId === ANTHROPIC && shared?.type === "oauth") sharedWithClaude = projectToClaude(shared);
      if (codexOAuthCredentialSink && providerId === OPENAI_CODEX && shared?.type === "oauth") {
        codexOAuthCredentialSink.project(shared);
        sharedWithCodex = true;
      }
      return Object.freeze({
        provider: providerId,
        credentialType: "oauth",
        harnesses: Object.freeze(sharedWithClaude ? ["pi", "claude-code"] : sharedWithCodex ? ["pi", "codex"] : ["pi"]),
      });
    });
  }

  async function logoutOAuth(provider, { harness = "pi" } = {}) {
    const providerId = normalizedProvider(provider);
    const harnessId = normalizedHarness(harness);
    return withProviderReservation(providerId, harnessId, async () => {
      if (harnessId === "gemini") {
        if (providerId !== GEMINI_CLI) throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth for Gemini CLI`);
        if (!geminiOAuthCredentialSink.status().configured) throw credentialError("credential_not_found", "Gemini CLI has no stored Google OAuth credential");
        geminiOAuthCredentialSink.remove();
        return Object.freeze({ provider: providerId, harness: harnessId, removed: true, harnesses: Object.freeze(["gemini"]) });
      }
      if (harnessId === "amp") {
        if (providerId !== AMP) throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support login for Amp`);
        if (!ampOAuthCredentialSink.status().configured) throw credentialError("credential_not_found", "Amp has no stored credential");
        await ampOAuthCredentialSink.remove();
        return Object.freeze({ provider: providerId, harness: harnessId, removed: true, harnesses: Object.freeze(["amp"]) });
      }
      if (harnessId === "claude-code") {
        if (providerId !== "anthropic") throw credentialError("oauth_provider_not_found", `provider ${providerId} does not support OAuth for Claude Code`);
        if (!claudeOAuthCredentialSink.status().configured) {
          throw credentialError("credential_not_found", "Claude Code has no stored Anthropic OAuth credential");
        }
        claudeOAuthCredentialSink.remove();
        return Object.freeze({ provider: providerId, harness: harnessId, removed: true, harnesses: Object.freeze(["claude-code"]) });
      }

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
      if (claudeOAuthCredentialSink && providerId === ANTHROPIC) {
        // The same grant backed Claude Code; a stale mirror would only fail later.
        try { claudeOAuthCredentialSink.remove(); }
        catch (error) { console.warn(`[oyster] Claude Code credential store was not cleared: ${error?.message ?? error}`); }
      }
      if (codexOAuthCredentialSink && providerId === OPENAI_CODEX) codexOAuthCredentialSink.remove();
      return Object.freeze({
        provider: providerId,
        removed: true,
        harnesses: Object.freeze(providerId === ANTHROPIC && claudeOAuthCredentialSink
          ? ["pi", "claude-code"]
          : providerId === OPENAI_CODEX && codexOAuthCredentialSink ? ["pi", "codex"] : ["pi"]),
      });
    });
  }

  async function syncClaudeOAuth() {
    if (!claudeOAuthCredentialSink) return Object.freeze({ outcome: "unavailable" });
    return withProviderReservation(ANTHROPIC, "pi", () => withProviderReservation(ANTHROPIC, "claude-code", async () => {
      const adapter = await load();
      await prepare(adapter);
      return syncAnthropicOAuth(adapter);
    }));
  }

  async function syncCodexOAuth() {
    if (!codexOAuthCredentialSink) return Object.freeze({ outcome: "unavailable" });
    return withProviderReservation(OPENAI_CODEX, "pi", async () => {
      const adapter = await load();
      await prepare(adapter);
      const credential = storedCredential(adapter, OPENAI_CODEX);
      if (credential?.type !== "oauth") {
        codexOAuthCredentialSink.remove();
        return Object.freeze({ outcome: "not_configured" });
      }
      codexOAuthCredentialSink.project(credential);
      return Object.freeze({ outcome: "synced", expiresAt: credential.expires });
    });
  }

  return Object.freeze({
    load, listStoredCredentials, listProviders, setApiKey, removeApiKey, loginOAuth, logoutOAuth,
    rotateAnthropicOAuth, rotateProviderOAuth, syncClaudeOAuth, syncCodexOAuth,
  });
}
