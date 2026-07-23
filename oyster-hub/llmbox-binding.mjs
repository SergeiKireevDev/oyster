import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

function decodeEnvelope(raw, operation) {
  let envelope;
  try { envelope = JSON.parse(raw); }
  catch { throw new Error(`llmbox native ${operation} returned invalid JSON`); }
  if (!envelope?.ok) throw new Error(envelope?.error || `llmbox native ${operation} failed`);
  return envelope;
}

export async function openLlmboxBinding(config, {
  loadAddon = (path) => require(path),
} = {}) {
  const addonPath = resolve(config.addonPath);
  const addon = loadAddon(addonPath);
  for (const method of ["open", "invoke", "close"]) {
    if (typeof addon?.[method] !== "function") throw new Error(`llmbox addon at ${addonPath} does not export ${method}()`);
  }
  const opened = decodeEnvelope(await addon.open(JSON.stringify({
    config_path: resolve(config.configPath),
    explicit: true,
  })), "open");
  const handle = opened.handle;
  let closed = false;
  let closePromise = null;

  async function invoke(operation, input = {}) {
    if (closed) throw new Error("llmbox native binding is closed");
    const result = decodeEnvelope(await addon.invoke(
      handle,
      String(operation),
      JSON.stringify(input ?? {}),
      config.timeoutMs,
    ), operation);
    return result.value ?? {};
  }

  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = Promise.resolve(addon.close(handle, config.closeTimeoutMs))
      .then((raw) => decodeEnvelope(raw, "close"))
      .then(() => undefined);
    return closePromise;
  }

  return Object.freeze({
    transport: "native",
    address: opened.addr || null,
    invoke,
    close,
  });
}
