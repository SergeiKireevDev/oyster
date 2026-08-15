import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SUDO_COMMAND = /(^|[\n;|&()])(\s*)sudo(?=\s|$)/g;
const SUDO_AT_START = /^\s*sudo(?=\s|$)/;

export function containsSudoCommand(command: string): boolean {
  SUDO_COMMAND.lastIndex = 0;
  return SUDO_COMMAND.test(command);
}

export function useSudoStdin(command: string): string {
  SUDO_COMMAND.lastIndex = 0;
  return command.replace(SUDO_COMMAND, (_match, boundary: string, spacing: string) => `${boundary}${spacing}sudo -S -p ''`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function runEntireCommandWithSudo(command: string): string {
  return `sudo -S -p '' -- /bin/bash -c ${shellQuote(command)}`;
}

function operationsWithPassword(password: string, { elevateEntireCommand = false } = {}): BashOperations {
  const local = createLocalBashOperations();
  return {
    exec(command, cwd, options) {
      const authorizedCommand = elevateEntireCommand ? runEntireCommandWithSudo(command) : useSudoStdin(command);
      return local.exec(authorizedCommand, cwd, { ...options, stdin: `${password}\n` });
    },
  };
}

async function requestPassword(ctx: any, command: string): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  return ctx.ui.input(`Sudo password required for: ${command}`, "Password", {
    secret: true,
    signal: ctx.signal,
  });
}

/**
 * Adds an explicit `sudo` flag to the model-facing bash tool. When true, the
 * complete command is run by a root-owned bash after an authenticated masked
 * prompt. Interactive `!` shell commands retain exact sudo-token detection.
 */
export default function sudoExtension(pi: ExtensionAPI) {
  const cwd = process.cwd();
  const baseBash = createBashTool(cwd);
  const pendingPasswords = new Map<string, string>();

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const sudo = (event.input as { sudo?: unknown }).sudo === true;
    if (!sudo) return undefined;

    const command = String((event.input as { command?: unknown }).command ?? "");
    const password = await requestPassword(ctx, command);
    if (password === undefined) {
      return { block: true, reason: "Sudo command cancelled: no password was provided" };
    }
    pendingPasswords.set(event.toolCallId, password);
    return undefined;
  });

  pi.registerTool({
    ...baseBash,
    description: `${baseBash.description} Set sudo=true to run the complete command as root after a masked password prompt; do not include sudo in the command.`,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute (omit the sudo prefix when sudo=true)" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
      sudo: Type.Optional(Type.Boolean({ description: "Run the complete command as root after prompting for the sudo password" })),
    }),
    async execute(id, params: { command: string; timeout?: number; sudo?: boolean }, signal, onUpdate, ctx) {
      const password = pendingPasswords.get(id);
      pendingPasswords.delete(id);
      if (params.sudo !== true) {
        return baseBash.execute(id, params, signal, onUpdate, ctx);
      }
      if (password === undefined) {
        throw new Error("Sudo command blocked because no password was authorized");
      }

      const elevatedBash = createBashTool(ctx?.cwd ?? cwd, {
        operations: operationsWithPassword(password, { elevateEntireCommand: true }),
      });
      return elevatedBash.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.on("user_bash", async (event, ctx) => {
    if (!containsSudoCommand(event.command)) return undefined;
    if (!SUDO_AT_START.test(event.command)) {
      return {
        result: {
          output: "Sudo commands must begin the bash command so credentials cannot be consumed by an earlier process",
          exitCode: 1,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const password = await requestPassword(ctx, event.command);
    if (password === undefined) {
      return {
        result: {
          output: "Sudo command cancelled: no password was provided",
          exitCode: 1,
          cancelled: true,
          truncated: false,
        },
      };
    }
    return { operations: operationsWithPassword(password) };
  });

  pi.on("session_shutdown", () => {
    pendingPasswords.clear();
  });
}
