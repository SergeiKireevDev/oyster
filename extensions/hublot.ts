/**
 * hublot.ts — pi extension exposing the Oyster "interfaces" feature
 * as the "hublot" tool the LLM can call directly from the harness.
 *
 * A "hublot" (French for porthole) is a public web interface: a cloudflared
 * tunnel to a local port, managed by the Oyster server (`server/server.mjs`).
 * Opening starts a Cloudflare tunnel to a caller-provided port and persists
 * its entry in SQLite. The caller provisions and manages the local service.
 *
 * Config: the UI server is found at OYSTER_URL (default http://127.0.0.1:8080)
 * and authenticated with OYSTER_TOKEN or the .ui-token file at the project
 * project root.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE = process.env.OYSTER_URL ?? "http://127.0.0.1:8080";

function uiToken(): string {
  if (process.env.OYSTER_TOKEN) return process.env.OYSTER_TOKEN.trim();
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
  throw new Error("Oyster token not found (set OYSTER_TOKEN or provide .ui-token)");
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${uiToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `${method} ${path} failed (${res.status})`);
  return data as any;
}

export default function hublotExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "hublot",
    label: "Live Interface",
    description:
      "Open, close, or list public Cloudflare tunnels for this session. " +
      "'open' requires a port (1–65535) of a service provisioned separately; it starts only the tunnel and persists its entry in SQLite. " +
      "Provide an optional description as its label. 'close' stops the tunnel by id or port; the local service remains running. " +
      "If creation fails, fix the underlying issue and try to revive the existing hublot, reusing its already-pinned widget. " +
      "Find its hublotId in pinned_widget list results (not the widget id), then send an authenticated POST to " +
      "/tunnels/reopen with {id: hublotId}. Do not create or pin a new hublot for a retry. " +
      "Use only when public access is required. Quick-tunnel URLs are ephemeral.",
    parameters: Type.Object({
      action: StringEnum(["open", "close", "list"] as const),
      description: Type.Optional(Type.String({ description: "For 'open': optional hublot label" })),
      session_id: Type.Optional(
        Type.String({
          description:
            "For 'open': bind the hublot to this session id instead of the current one " +
            "(use when opening on behalf of another session, e.g. from a one-shot agent)",
        }),
      ),
      id: Type.Optional(Type.String({ description: "For 'close': hublot id" })),
      port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535, description: "Required for open: existing local service port; for close: tunnel port" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();

      if (params.action === "open") {
        if (!Number.isInteger(params.port) || params.port! < 1 || params.port! > 65535) throw new Error("'open' requires a port between 1 and 65535");
        onUpdate?.({ content: [{ type: "text", text: "Starting Cloudflare tunnel…" }] });
        const data = await api("POST", "/tunnels", {
          label: params.description?.slice(0, 200),
          port: params.port,
          sessionId: params.session_id ?? sessionId,
        });
        const t = data.tunnel;
        return { content: [{ type: "text", text: `Hublot ready: ${t.url} → http://localhost:${t.port}` }], details: t };
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
          content: [{ type: "text", text: `Hublot closed: ${data.closed.url} (port ${data.closed.port}). Tunnel stopped. The local service remains running.` }],
          details: data.closed,
        };
      }

      // list
      const { tunnels } = await api("GET", "/tunnels");
      const mine = tunnels.filter((t: any) => !t.sessionId || t.sessionId === sessionId);
      const lines = mine.map(
        (t: any) => `- id=${t.id} port=${t.port} ${t.url ?? `(waiting: ${t.status})`}${t.label ? ` — ${t.label}` : ""}${t.sessionId === sessionId ? "" : " (unbound)"}`,
      );
      return {
        content: [{ type: "text", text: lines.length ? `Hublots for this session:\n${lines.join("\n")}` : "No hublots open for this session." }],
        details: { tunnels: mine },
      };
    },
  });
}
