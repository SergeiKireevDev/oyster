import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CAPABILITY_ERROR = "credential_service_unavailable";

function capabilityError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = CAPABILITY_ERROR;
  return error;
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

  return Object.freeze({ load });
}
