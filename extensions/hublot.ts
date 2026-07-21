/**
 * hublot.ts — pi extension exposing the pi-remote-ui "interfaces" feature
 * as the "hublot" tool the LLM can call directly from the harness.
 *
 * A "hublot" (French for porthole) is a public web interface: a cloudflared
 * tunnel to a local port, managed by the pi-remote-ui server (`server/server.mjs`).
 * Opening one through this tool:
 *   - lets the server allocate the next free port (3000+)
 *   - has a background pi agent bring up the local service first
 *   - opens cloudflared only after that service answers, then binds the
 *     interface to the CURRENT session so it appears ready in the UI, and
 *     is torn down (service + agent + tunnel) when closed or when the
 *     session is deleted. Quick-tunnel URLs are ephemeral: a verified tunnel
 *     that survived a UI restart is retained, but a stale one is never
 *     recreated automatically.
 *
 * Config: the UI server is found at PI_UI_URL (default http://127.0.0.1:8080)
 * and authenticated with PI_UI_TOKEN or the .ui-token file at the project
 * project root.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE = process.env.PI_UI_URL ?? "http://127.0.0.1:8080";

function uiToken(): string {
  if (process.env.PI_UI_TOKEN) return process.env.PI_UI_TOKEN.trim();
  // Try the current project first, then next to this file's project root.
  const candidates = [
    join(process.cwd(), ".ui-token"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ui-token"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8").trim();
    } catch {}
  }
  throw new Error("pi-remote-ui token not found (set PI_UI_TOKEN or provide .ui-token)");
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(uiToken())}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `${method} ${path} failed (${res.status})`);
  return data as any;
}

export default function hublotExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hublot",
    label: "Hublot",
    description:
      "Manage hublots — public web interfaces (cloudflared tunnels to local ports) for this " +
      "session. When the user asks to 'create/open a hublot', use this tool. " +
      "Actions: 'open' creates a hublot — the server allocates a free local port and returns " +
      "the public URL; a background agent is spawned to serve `description` on that " +
      "port before the tunnel opens. 'close' tears one " +
      "down (service process, background agent and tunnel) by id or port. 'list' shows the " +
      "session's hublots. Opened hublots appear automatically in the pi-remote-ui. " +
      "Cloudflared quick-tunnel URLs are ephemeral: after a UI server restart, stale tunnels " +
      "are closed instead of recreated; use 'open' afterwards to obtain a fresh URL.",
    promptSnippet: "Open/close/list hublots (public web interfaces / tunnels) for this session",
    promptGuidelines: [
      "A 'hublot' is a public web interface. Use hublot with action=open and a clear " +
        "description of what should be served; the background agent will create and persist " +
        "an idempotent startup script before the tunnel opens.",
      "Use hublot with action=close (id or port) instead of killing cloudflared processes manually.",
      "Do not start or serve the hublot port yourself; hublots are always agent-managed.",
      "Cloudflared quick-tunnel URLs are not restartable. If a hublot is no longer listed " +
        "after a UI server restart, open a new one for a fresh URL instead of reusing the old URL.",
    ],
    parameters: Type.Object({
      action: StringEnum(["open", "close", "list"] as const),
      description: Type.Optional(
        Type.String({
          description:
            "For 'open': what the hublot should expose (becomes the label and the " +
            "brief given to the background agent that sets it up)",
        }),
      ),
      session_id: Type.Optional(
        Type.String({
          description:
            "For 'open': bind the hublot to this session id instead of the current one " +
            "(use when opening on behalf of another session, e.g. from a one-shot agent)",
        }),
      ),
      id: Type.Optional(Type.String({ description: "For 'close': hublot id" })),
      port: Type.Optional(Type.Number({ description: "For 'close': local port of the hublot" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();

      if (params.action === "open") {
        if (!params.description) throw new Error("'open' requires a description");
        onUpdate?.({ content: [{ type: "text", text: "Preparing local service…" }] });
        const data = await api("POST", "/tunnels", {
          label: params.description.slice(0, 200),
          brief: params.description,
          sessionId: params.session_id ?? sessionId,
        });
        const t = data.tunnel;
        const text = `Hublot ready: ${t.url} → http://localhost:${t.port}\n` +
          `The background agent brought the local service up before the tunnel was opened. ` +
          `Do not serve the port yourself.`;
        return { content: [{ type: "text", text }], details: t };
      }

      if (params.action === "close") {
        let id = params.id ?? null;
        if (!id) {
          if (!params.port) throw new Error("'close' requires an id or a port");
          const { tunnels } = await api("GET", "/tunnels");
          const t = tunnels.find((x: any) => x.port === params.port);
          if (!t) throw new Error(`no hublot on port ${params.port}`);
          id = t.id;
        }
        const data = await api("DELETE", `/tunnels?id=${encodeURIComponent(id!)}`);
        return {
          content: [{ type: "text", text: `Hublot closed: ${data.closed.url} (port ${data.closed.port}). Service, agent and tunnel were terminated.` }],
          details: data.closed,
        };
      }

      // list
      const { tunnels } = await api("GET", "/tunnels");
      const mine = tunnels.filter((t: any) => !t.sessionId || t.sessionId === sessionId);
      const lines = mine.map(
        (t: any) => `- id=${t.id} port=${t.port} ${t.url}${t.label ? ` — ${t.label}` : ""}${t.sessionId === sessionId ? "" : " (unbound)"}`,
      );
      return {
        content: [{ type: "text", text: lines.length ? `Hublots for this session:\n${lines.join("\n")}` : "No hublots open for this session." }],
        details: { tunnels: mine },
      };
    },
  });
}
