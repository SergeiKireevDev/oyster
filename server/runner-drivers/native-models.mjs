import { spawn } from "node:child_process";
import { CODEX_OPENROUTER_ARGS } from "../openrouter-routing.mjs";
import { createInterface } from "node:readline";

/** Short-lived native protocol connection. Never sends a prompt or logs credentials. */
export async function withNativeRpc({ bin, args, cwd, env, signal, timeout = 20000, spawnImpl = spawn }, operation) {
  const child = spawnImpl(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 0;
  let failure;
  const fail = (error) => {
    failure = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const abort = () => fail(new Error("Model discovery cancelled"));
  const timer = setTimeout(() => fail(new Error("Native model discovery timed out")), timeout);
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Native model discovery exited before responding")));
  child.stdin.on("error", fail);
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    if (value.error) request.reject(Object.assign(new Error(value.error.message || "Native discovery failed"), { code: value.error.code }));
    else request.resolve(value.result);
  });
  const send = (method, params, id) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params })}\n`);
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send(method, params, id);
  });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try { return await operation(rpc, (method, params = {}) => send(method, params)); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    lines.close();
    child.stdin.end();
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
    kill.unref();
    child.once("close", () => clearTimeout(kill));
  }
}

export function discoverCodexModels(options) {
  return withNativeRpc({ ...options, args: ["app-server", "--stdio", ...(options.provider === "openrouter" ? CODEX_OPENROUTER_ARGS : [])] }, async (rpc, notify) => {
    await rpc("initialize", { clientInfo: { name: "oyster", version: "1.0.0" } });
    notify("initialized");
    if (options.provider !== "openrouter") {
      const { account } = await rpc("account/read", { refreshToken: false });
      if (!account) return [];
    }
    const models = [];
    let cursor = null;
    const cursors = new Set();
    do {
      const page = await rpc("model/list", { cursor, limit: 100 });
      for (const model of page.data ?? []) {
        if (model.hidden || !model.model || models.some((item) => item.id === model.model)) continue;
        models.push({ provider: options.provider === "openrouter" ? "openrouter" : "openai", id: model.model, name: model.displayName ?? model.model });
      }
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor)) throw new Error("Codex model catalog repeated a page");
      cursors.add(cursor);
    } while (cursor);
    return models;
  });
}

export function discoverGeminiModels(options) {
  return withNativeRpc({ ...options, args: ["--acp", "--skip-trust"] }, async (rpc) => {
    await rpc("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "oyster", version: "1.0.0" } });
    try {
      const session = await rpc("session/new", { cwd: options.cwd, mcpServers: [] });
      return (session.models?.availableModels ?? []).map((model) => ({ provider: "google", id: model.modelId, name: model.name ?? model.modelId }));
    } catch (error) {
      if (error.code === -32000) return [];
      throw error;
    }
  });
}

// Amp 0.0.1788696031 exposes modes, not a model-list RPC. These are its documented --mode values.
export const AMP_MODES = Object.freeze(["low", "medium", "high", "ultra"]);
export function ampModels() {
  return AMP_MODES.map((id) => ({ provider: "amp", id, name: `Amp ${id} mode (automatic model routing)` }));
}
