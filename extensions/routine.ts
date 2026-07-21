/**
 * routine.ts — pi extension exposing the pi-remote-ui "routines" feature
 * as the "routine" tool the LLM can call directly from the harness.
 *
 * A routine is a runnable script in the global store ~/.pi/routines/,
 * bound to the session using it and driven by the pi-remote-ui server
 * (server.mjs) through a tiny protocol:
 *
 *   <script> run       – the main job (started via action=start)
 *   <script> teardown  – removes every byproduct the run created
 *
 * Both execute with cwd = the workdir of the binding session. While running,
 * the script natively reports progression by printing lines to stdout:
 *
 *   ::progress 40 building assets     -> progress bar at 40%, message shown
 *   ::progress installing deps        -> message only (percent unknown)
 *
 * Creating/starting a routine binds it to the CURRENT session: it shows up
 * instantly in the UI sidebar (via SSE), other sessions cannot start it
 * until released, and deleting the session stops and releases it.
 *
 * Config: the UI server is found at PI_UI_URL (default http://127.0.0.1:8080)
 * and authenticated with PI_UI_TOKEN or the .ui-token file at the project
 * root (next to server.mjs).
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
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ui-token"),
    "/home/ubuntu/tree-pi/.ui-token",
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

function describe(r: any): string {
  const bits = [`status=${r.status}`];
  if (r.progress !== null && r.progress !== undefined) bits.push(`progress=${r.progress}%`);
  if (r.message) bits.push(`message=${JSON.stringify(r.message)}`);
  if (r.exitCode !== null && r.exitCode !== undefined) bits.push(`exit=${r.exitCode}`);
  if (r.cwd) bits.push(`cwd=${r.cwd}`);
  return `${r.name}: ${bits.join(" ")}`;
}

export default function routineExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "routine",
    label: "Routine",
    description:
      "Manage routines — runnable scripts stored in ~/.pi/routines/ and bound to this session, " +
      "with native progression reporting in the pi-remote-ui sidebar. When the user asks to " +
      "'create a routine' for some task, use action=create with a `script` implementing the " +
      "protocol: the script receives one argument, `run` (do the job) or `teardown` (remove " +
      "EVERY byproduct the run created), and reports progression by printing " +
      "'::progress <0-100> <message>' lines to stdout. Both modes execute with cwd = this " +
      "session's workdir. Actions: 'create' writes the script (0755) and binds it to this " +
      "session; 'start' runs it; 'stop' kills it (SIGTERM/SIGKILL to its process group); " +
      "'teardown' removes its byproducts; 'status' reports live state, progress and recent " +
      "output; 'list' shows this session's routines; 'release' unbinds it so other sessions " +
      "can use it; 'delete' removes the script itself.",
    promptSnippet:
      "Create/start/stop/teardown session-bound routines (runnable scripts with progress reporting)",
    promptGuidelines: [
      "A 'routine' is a repeatable, user-visible job (build, deploy, data refresh…). When the " +
        "user asks for one, write the script yourself and register it with routine action=create " +
        "— do not just drop a file in the project.",
      "Routine scripts MUST handle both arguments: `run` and `teardown` (teardown removes every " +
        "byproduct run created), SHOULD print '::progress <0-100> <message>' milestones on " +
        "stdout, and must be self-contained (shebang, set -u, no interactive input).",
      "Prefer routine action=start over running such scripts manually, so the user sees live " +
        "progression in the UI and can stop/teardown from there.",
    ],
    parameters: Type.Object({
      action: StringEnum(["create", "start", "stop", "teardown", "status", "list", "release", "delete"] as const),
      name: Type.Optional(
        Type.String({
          description: "Routine file name, e.g. 'rebuild-db.sh' (required for everything except 'list')",
        }),
      ),
      script: Type.Optional(
        Type.String({
          description:
            "For 'create': full script content, starting with a shebang, handling the `run` and " +
            "`teardown` arguments and printing '::progress <0-100> <message>' lines while running",
        }),
      ),
      session_id: Type.Optional(
        Type.String({
          description:
            "For 'create'/'start': bind the routine to this session id instead of the current one " +
            "(use when acting on behalf of another session, e.g. from a one-shot agent)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = params.session_id ?? ctx.sessionManager.getSessionId();
      const { action, name } = params;

      if (action === "list") {
        const { routines, dir } = await api("GET", "/routines");
        const mine = routines.filter((r: any) => !r.sessionId || r.sessionId === sessionId);
        const elsewhere = routines.length - mine.length;
        const lines = mine.map((r: any) => `- ${describe(r)}${r.sessionId ? "" : " (unbound)"}`);
        const note = elsewhere ? `\n(${elsewhere} more bound to other sessions — not usable here until released)` : "";
        return {
          content: [{ type: "text", text: (lines.length ? `Routines in ${dir}:\n${lines.join("\n")}` : `No routines available (store: ${dir}).`) + note }],
          details: { routines: mine, boundElsewhere: elsewhere },
        };
      }

      if (!name) throw new Error(`'${action}' requires a name`);

      if (action === "status") {
        const { routines } = await api("GET", "/routines");
        const r = routines.find((x: any) => x.name === name);
        if (!r) throw new Error(`no such routine: ${name}`);
        const tail = (r.log ?? []).slice(-10).join("\n");
        return {
          content: [{ type: "text", text: describe(r) + (tail ? `\nrecent output:\n${tail}` : "") }],
          details: r,
        };
      }

      if (action === "create" && !params.script) throw new Error("'create' requires a script");

      const { routine } = await api("POST", "/routines", {
        name,
        action,
        sessionId,
        ...(action === "create" ? { script: params.script } : {}),
      });

      const text = {
        create:
          `Routine "${routine.name}" created at ${routine.path} and bound to this session ` +
          `(runs in ${routine.cwd ?? "the session workdir"}). It appears in the UI sidebar; ` +
          `start it with routine action=start.`,
        start:
          `Routine "${routine.name}" started (cwd ${routine.cwd ?? "?"}). Progression from its ` +
          `'::progress' lines streams live to the UI; check on it with routine action=status.`,
        stop: `Routine "${routine.name}" is being stopped (SIGTERM to its process group, SIGKILL after 4s).`,
        teardown: `Routine "${routine.name}" teardown started — its byproducts are being removed.`,
        release: `Routine "${routine.name}" released — it is no longer bound to a session.`,
        delete: `Routine "${routine.name}" deleted from the store (its byproducts were NOT touched).`,
      }[action];

      return { content: [{ type: "text", text }], details: routine };
    },
  });
}
