/** Pin workspace artifacts into Oyster's durable Pinned Widgets rail. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE = process.env.OYSTER_URL ?? "http://127.0.0.1:8080";

function uiToken(): string {
  if (process.env.OYSTER_TOKEN) return process.env.OYSTER_TOKEN.trim();
  for (const path of [
    join(process.cwd(), ".ui-token"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ui-token"),
  ]) {
    try { return readFileSync(path, "utf8").trim(); } catch {}
  }
  throw new Error("Oyster token not found (set OYSTER_TOKEN or provide .ui-token)");
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
      "Pin, monitor, list, organize, move, or unpin artifacts in Oyster's right sidebar. " +
      "A monitor stores permanent preview and content scripts under ~/.oyster, polls its preview every 3 seconds " +
      "only while visible, and runs its content script when opened. Pinned artifacts stay private. " +
      "Use the hublot tool only when a public live interface is required.",
    promptSnippet: "Pin private artifacts or create script-backed monitoring widgets with pinned_widget. Monitoring scripts must be complete executable scripts with shebangs; use format='diff' for code diffs. Use group_pinned_widgets for multiple related files. Unpinning never deletes source files or monitoring scripts.",
    parameters: Type.Object({
      action: StringEnum(["pin", "monitor", "list", "unpin", "group", "move"] as const),
      path: Type.Optional(Type.String({ description: "For pin: artifact path, absolute or relative to the session cwd" })),
      preview_script: Type.Optional(Type.String({ description: "For monitor: complete shebang script whose stdout is the compact thumbnail preview" })),
      content_script: Type.Optional(Type.String({ description: "For monitor: complete shebang script whose stdout is shown in the viewer" })),
      cwd: Type.Optional(Type.String({ description: "For monitor: script working directory; defaults to the session cwd" })),
      format: Type.Optional(StringEnum(["text", "diff"] as const, { description: "For monitor: viewer format; defaults to text" })),
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
      if (params.action === "monitor") {
        if (!params.label?.trim()) throw new Error("'monitor' requires a label");
        if (!params.preview_script || !params.content_script) throw new Error("'monitor' requires preview_script and content_script");
        const data = await api("POST", "/pinned-widgets", {
          label: params.label,
          previewScript: params.preview_script,
          contentScript: params.content_script,
          cwd: resolve(ctx.cwd, params.cwd ?? "."),
          format: params.format ?? "text",
          groupId: params.group_id,
          sessionId,
          scope,
        });
        const widget = data.widget;
        return {
          content: [{ type: "text", text: `Created monitoring widget ${widget.label} (id=${widget.id}). Its permanent scripts are stored in ${widget.scriptDirectory}.` }],
          details: widget,
        };
      }
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

  pi.registerTool({
    name: "group_pinned_widgets",
    label: "Group Pinned Widgets",
    description:
      "Create one Pinned Widgets group and place multiple related documentation or media files into it in one call. " +
      "Already-pinned files are moved into the new group; new files are pinned there. Source files are never changed.",
    promptSnippet: "When one task produces four or more documentation or media artifacts, call group_pinned_widgets once with a descriptive group name and every artifact path before finishing.",
    parameters: Type.Object({
      group: Type.String({ description: "Short descriptive name for the new widget group" }),
      paths: Type.Array(Type.String({ description: "Artifact path, absolute or relative to the session cwd" }), {
        minItems: 2,
        maxItems: 100,
        description: "Two or more related documentation or media files to pin into the group",
      }),
      scope: Type.Optional(StringEnum(["session", "workspace"] as const, { description: "Pin scope; defaults to the current session" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const name = params.group.trim();
      if (!name) throw new Error("'group' requires a name");
      const paths = [...new Set(params.paths.map((path) => resolve(ctx.cwd, path)))];
      if (paths.length < 2) throw new Error("'paths' requires at least two distinct artifact paths");

      const sessionId = ctx.sessionManager.getSessionId();
      const scope = params.scope ?? "session";
      const query = new URLSearchParams({ scope });
      if (sessionId) query.set("sessionId", sessionId);
      const before = await api("GET", `/pinned-widgets?${query}`);
      const existingByPath = new Map<string, any>(
        (before.widgets ?? []).filter((widget: any) => widget.path).map((widget: any) => [resolve(widget.path), widget]),
      );
      const grouped = await api("POST", "/pinned-widget-groups", { name, sessionId, scope });
      const group = grouped.group;
      const changed: Array<{ widget: any; existing: any | null }> = [];

      try {
        for (const path of paths) {
          const existing = existingByPath.get(path) ?? null;
          const data = existing
            ? await api("PATCH", "/pinned-widgets", { id: existing.id, groupId: group.id, sessionId })
            : await api("POST", "/pinned-widgets", { path, groupId: group.id, sessionId, scope });
          changed.push({ widget: data.widget, existing });
        }
      } catch (error) {
        for (const item of changed.reverse()) {
          try {
            if (item.existing) {
              await api("PATCH", "/pinned-widgets", {
                id: item.widget.id,
                groupId: item.existing.groupId ?? null,
                sessionId,
              });
            } else {
              await api("DELETE", `/pinned-widgets?id=${encodeURIComponent(item.widget.id)}`);
            }
          } catch {}
        }
        try { await api("DELETE", `/pinned-widget-groups?id=${encodeURIComponent(group.id)}&ungroup=1`); } catch {}
        throw error;
      }

      const widgets = changed.map((item) => item.widget);
      return {
        content: [{
          type: "text",
          text: `Created widget group ${group.name} with ${widgets.length} artifacts (id=${group.id}).`,
        }],
        details: { group, widgets },
      };
    },
  });
}
