import { readFileSync, mkdirSync, symlinkSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export const OPENROUTER_HARNESSES = Object.freeze(["codex", "claude-code"]);
export const CODEX_OPENROUTER_ARGS = Object.freeze([
  "-c", 'model_provider="openrouter"',
  "-c", 'model_providers.openrouter.name="openrouter"',
  "-c", 'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
  "-c", 'model_providers.openrouter.auth.command="/usr/bin/printenv"',
  "-c", 'model_providers.openrouter.auth.args=["OPENROUTER_API_KEY"]',
]);

// Read only literal API keys. Never execute pi's command-based credentials here.
export function resolveOpenRouterKey({ authPath, env = process.env } = {}) {
  let entry;
  try { entry = JSON.parse(readFileSync(authPath, "utf8"))?.openrouter; } catch { /* no saved key */ }
  const valid = (value) => typeof value === "string" && value.trim() && !/[\r\n\0]/u.test(value) && value.length <= 16 * 1024 && !value.trim().startsWith("!");
  if (entry?.type === "api_key" && valid(entry.key)) return entry.key.trim();
  return valid(env.OPENROUTER_API_KEY) ? env.OPENROUTER_API_KEY.trim() : null;
}

export async function createOpenRouterRouting({ repository, config }) {
  const enabled = OPENROUTER_HARNESSES.filter((id) => config[id === "codex" ? "CODEX_BIN" : "CLAUDE_CODE_BIN"]);
  const routes = {};
  for (const id of enabled) {
    const row = await repository.get(`harness_provider_${id}`);
    try { routes[id] = JSON.parse(row?.value) === "openrouter" ? "openrouter" : "native"; }
    catch { routes[id] = "native"; }
  }
  const authPath = join(config.PI_AGENT_DIR, "auth.json");
  const key = () => resolveOpenRouterKey({ authPath });
  return {
    provider: (id) => routes[id] ?? "native",
    status: () => ({ routes: { ...routes }, keyAvailable: Boolean(key()), ampSetup: Boolean(config.AMP_BIN) }),
    async select(id, provider) {
      if (!enabled.includes(id) || !["native", "openrouter"].includes(provider)) throw new Error("Unsupported harness provider");
      if (provider === "openrouter" && !key()) throw new Error("Save an OpenRouter API key first");
      await repository.set(`harness_provider_${id}`, JSON.stringify(provider), new Date().toISOString());
      routes[id] = provider;
    },
    launch(id) {
      if (routes[id] !== "openrouter") return null;
      const secret = key();
      if (!secret) throw new Error("OpenRouter API key is not configured");
      if (id === "codex") return { provider: "openrouter", env: { OPENROUTER_API_KEY: secret, OPENAI_API_KEY: "", CODEX_API_KEY: "", ...(config.CODEX_HOME ? { CODEX_HOME: config.CODEX_HOME } : {}) } };
      // Isolate gateway auth from saved OAuth, while retaining the native project
      // tree used by --resume and Oyster's existing SQLite transcript sink.
      const directory = join(config.PI_AGENT_DIR, "oyster-claude-openrouter");
      const projects = resolve(config.CLAUDE_CODE_PROJECTS_DIR ?? join(config.CLAUDE_CONFIG_DIR, "projects"));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      mkdirSync(projects, { recursive: true, mode: 0o700 });
      const link = join(directory, "projects");
      try { lstatSync(link); if (realpathSync(link) !== realpathSync(projects)) throw new Error("Unexpected gateway projects directory"); }
      catch (error) { if (error.code !== "ENOENT") throw error; symlinkSync(projects, link, "dir"); }
      return { provider: "openrouter", env: {
        CLAUDE_CONFIG_DIR: directory, ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_AUTH_TOKEN: secret, ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "",
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_FOUNDRY: "0",
        ANTHROPIC_CUSTOM_HEADERS: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.6",
      } };
    },
    decorate(providers) {
      const active = enabled.filter((id) => routes[id] === "openrouter");
      return [ ...providers.filter((row) => !active.includes(row.harness)).map((row) => ({ ...row,
        ...(row.harnesses ? { harnesses: row.harnesses.filter((id) => !active.includes(id)) } : {}),
      })), ...active.map((harness) => ({ provider: "openrouter", harness, displayName: "OpenRouter", registered: true,
        oauthCapable: false, credentialType: key() ? "api_key" : null, configured: Boolean(key()), source: "server", routed: true })) ];
    },
  };
}
