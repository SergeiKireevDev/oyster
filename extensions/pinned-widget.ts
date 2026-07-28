/** Pin workspace artifacts into Oyster's durable Pinned Widgets rail. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE = process.env.PI_UI_URL ?? "http://127.0.0.1:8080";

function uiToken(): string {
  if (process.env.PI_UI_TOKEN) return process.env.PI_UI_TOKEN.trim();
  for (const path of [
    join(process.cwd(), ".ui-token"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ui-token"),
  ]) {
    try { return readFileSync(path, "utf8").trim(); } catch {}
  }
  throw new Error("Oyster token not found (set PI_UI_TOKEN or provide .ui-token)");
}

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${uiToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(data.error ?? `${method} ${path} failed (${response.status})`);
  return data;
}

export default function pinnedWidgetExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pinned_widget",
    label: "Pinned Widget",
    description:
      "Pin, list, organize, move, or unpin artifacts in Oyster's right sidebar. " +
      "Pinned image, video, and Markdown files use Oyster's native viewers; pinning stays private " +
      "and does not create a public tunnel. Use the hublot tool only when a public live interface is required.",
    promptSnippet: "Pin private artifacts with pinned_widget; use hublot only for public interfaces. Unpinning never deletes the source.",
    parameters: Type.Object({
      action: StringEnum(["pin", "list", "unpin", "group", "move"] as const),
      path: Type.Optional(Type.String({ description: "For pin: artifact path, absolute or relative to the session cwd" })),
      url: Type.Optional(Type.String({ description: "For pin: an explicit HTTPS link instead of a local path" })),
      label: Type.Optional(Type.String({ description: "Optional short widget label" })),
      id: Type.Optional(Type.String({ description: "Widget id for unpin or move" })),
      group: Type.Optional(Type.String({ description: "For group: name of a new one-level group" })),
      group_id: Type.Optional(Type.String({ description: "Destination group id for pin or move; omit to use the top level" })),
      before_id: Type.Optional(Type.String({ description: "For move: place the widget before this sibling id" })),
      scope: Type.Optional(StringEnum(["session", "workspace"] as const, { description: "Pin scope; defaults to the current session" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const scope = params.scope ?? "session";
      if (params.action === "pin") {
        if (!!params.path === !!params.url) throw new Error("'pin' requires exactly one of path or url");
        const data = await api("POST", "/pinned-widgets", {
          ...(params.path ? { path: resolve(ctx.cwd, params.path) } : { url: params.url }),
          label: params.label,
          groupId: params.group_id,
          sessionId,
          scope,
        });
        const widget = data.widget;
        return {
          content: [{ type: "text", text: `Pinned ${widget.kind}: ${widget.label} (id=${widget.id}). It is private and opens in Oyster's native artifact display.` }],
          details: widget,
        };
      }
      if (params.action === "unpin") {
        if (!params.id) throw new Error("'unpin' requires id");
        await api("DELETE", `/pinned-widgets?id=${encodeURIComponent(params.id)}`);
        return { content: [{ type: "text", text: `Unpinned widget ${params.id}. The underlying artifact was not changed.` }], details: { id: params.id } };
      }
      if (params.action === "group") {
        if (!params.group?.trim()) throw new Error("'group' requires a name");
        const data = await api("POST", "/pinned-widget-groups", { name: params.group, sessionId, scope });
        return { content: [{ type: "text", text: `Created widget group ${data.group.name} (id=${data.group.id}).` }], details: data.group };
      }
      if (params.action === "move") {
        if (!params.id) throw new Error("'move' requires id");
        const data = await api("PATCH", "/pinned-widgets", {
          id: params.id,
          groupId: params.group_id ?? null,
          beforeId: params.before_id ?? null,
          sessionId,
        });
        return { content: [{ type: "text", text: `Moved ${data.widget.label}${data.widget.groupId ? ` into group ${data.widget.groupId}` : " to the top level"}.` }], details: data.widget };
      }

      const query = new URLSearchParams({ scope: "session" });
      if (sessionId) query.set("sessionId", sessionId);
      const data = await api("GET", `/pinned-widgets?${query}`);
      const widgets = (data.widgets ?? []).slice(0, 100);
      const groups = data.groups ?? [];
      const lines = widgets.map((widget: any) =>
        `- id=${widget.id} kind=${widget.kind} label=${JSON.stringify(widget.label)}${widget.groupId ? ` group=${widget.groupId}` : ""} status=${widget.availability}`,
      );
      if ((data.widgets ?? []).length > widgets.length) lines.push(`… ${(data.widgets ?? []).length - widgets.length} more widgets omitted`);
      return {
        content: [{ type: "text", text: lines.length ? `Pinned Widgets (${groups.length} groups):\n${lines.join("\n")}` : "No pinned widgets." }],
        details: { widgets, groups, total: (data.widgets ?? []).length },
      };
    },
  });
}
