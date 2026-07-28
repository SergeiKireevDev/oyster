/**
 * hublot.ts — pi extension exposing the Oyster "interfaces" feature
 * as the "hublot" tool the LLM can call directly from the harness.
 *
 * A "hublot" (French for porthole) is a public web interface: a cloudflared
 * tunnel to a local port, managed by the Oyster server (`server/server.mjs`).
 * Opening one through this tool:
 *   - lets the server allocate the next free port (3000+)
 *   - claims an already-connected tunnel from the rolling warm pool, replaces
 *     its waiting-page service with the requested local service, then binds
 *     the interface to the CURRENT session so it appears ready in the UI, and
 *     is torn down (service + agent + tunnel) when closed or when the
 *     session is deleted. Quick-tunnel URLs are ephemeral: a verified tunnel
 *     that survived a UI restart is retained, but a stale one is never
 *     recreated automatically.
 *
 * Config: the UI server is found at OYSTER_URL (default http://127.0.0.1:8080)
 * and authenticated with OYSTER_TOKEN or the .ui-token file at the project
 * project root.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
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
      "Manage live-interface widgets (legacy name: hublots) — public web interfaces (cloudflared tunnels to local ports) for this " +
      "session. When the user asks to 'create/open a hublot', use this tool. " +
      "Actions: 'open' creates a hublot — the server allocates a free local port and returns " +
      "the public URL. Normally a background agent serves `description`; deterministic " +
      "types bypass the agent: type='markdown' serves an absolute document path, while " +
      "type='git-server' serves an absolute Git worktree path through the bundled read-only " +
      "Smart HTTP server. 'close' tears one " +
      "down (service process, background agent and tunnel) by id or port. 'list' shows the " +
      "session's hublots. Opened hublots appear automatically in the Oyster. " +
      "Cloudflared quick-tunnel URLs are ephemeral: after a UI server restart, stale tunnels " +
      "are closed instead of recreated; use 'open' afterwards to obtain a fresh URL.",
    promptSnippet: "Open/close/list public live-interface widgets (hublot tunnels) for this session",
    promptGuidelines: [
      "A 'hublot' is a public live-interface widget. Use hublot with action=open only when public access is required, and provide a clear " +
        "description of what should be served. For ordinary hublots, the background agent " +
        "will create and persist an idempotent startup script before the tunnel opens.",
      "For private Markdown display, use pinned_widget. Only to expose a Markdown document publicly, use hublot with action=open, type=markdown, and an " +
        "absolute path to the Markdown file; the bundled Node.js Markdown reader starts directly.",
      "To expose a Git worktree for clone, fetch, or pull, use hublot with action=open, " +
        "type=git-server, and the absolute worktree path. The deterministic read-only Smart " +
        "HTTP server starts directly; pushes are denied.",
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
            "For 'open': what the hublot should expose (becomes the label and, for an " +
            "ordinary hublot, the brief given to the background agent that sets it up)",
        }),
      ),
      type: Type.Optional(
        StringEnum(["markdown", "git-server"] as const, {
          description: "For 'open': use 'markdown' for a document or 'git-server' for a read-only Git worktree",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description: "For type='markdown' or type='git-server': absolute path to the document or Git worktree",
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
        if (params.type === "markdown" || params.type === "git-server") {
          if (!params.path) throw new Error(`type='${params.type}' requires a path`);
          if (!isAbsolute(params.path)) throw new Error(`type='${params.type}' requires an absolute path`);
        } else if (params.path) {
          throw new Error("'path' is only valid with type='markdown' or type='git-server'");
        }
        onUpdate?.({
          content: [{
            type: "text",
            text: params.type === "markdown"
              ? "Starting bundled Markdown reader on a reserved public tunnel…"
              : params.type === "git-server"
                ? "Starting read-only Git Smart HTTP server on a reserved public tunnel…"
                : "Preparing local service on a reserved public tunnel…",
          }],
        });
        const data = await api("POST", "/tunnels", {
          label: params.description.slice(0, 200),
          brief: params.description,
          sessionId: params.session_id ?? sessionId,
          ...(params.type === "markdown" || params.type === "git-server" ? { type: params.type, path: params.path } : {}),
        });
        const t = data.tunnel;
        const serviceText = params.type === "markdown"
          ? `The bundled Node.js Markdown reader is serving ${params.path} directly on the allocated port.`
          : params.type === "git-server"
            ? `The read-only Git Smart HTTP server is serving ${params.path}; clone, fetch, and pull are supported, while push is denied.`
            : "The background agent brought the local service up before the tunnel was opened.";
        const text = `Hublot ready: ${t.url} → http://localhost:${t.port}\n` +
          `${serviceText} Do not serve the port yourself.`;
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
        (t: any) => `- id=${t.id} port=${t.port} ${t.url ?? `(waiting: ${t.status})`}${t.label ? ` — ${t.label}` : ""}${t.sessionId === sessionId ? "" : " (unbound)"}`,
      );
      return {
        content: [{ type: "text", text: lines.length ? `Hublots for this session:\n${lines.join("\n")}` : "No hublots open for this session." }],
        details: { tunnels: mine },
      };
    },
  });
}
