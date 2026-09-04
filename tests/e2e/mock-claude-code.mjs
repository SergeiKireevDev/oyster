#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const sessionId = option("--session-id") ?? option("--resume") ?? randomUUID();
let model = option("--model") ?? "sonnet";
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const projectDir = join(configDir, "projects", "-workspace");
const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
await mkdir(projectDir, { recursive: true });

let parentUuid = null;
try {
  for (const line of (await readFile(transcriptPath, "utf8")).trim().split("\n")) {
    const record = JSON.parse(line);
    if (typeof record.uuid === "string") parentUuid = record.uuid;
    if (record.type === "assistant" && typeof record.message?.model === "string") model = record.message.model;
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
emit({ type: "system", subtype: "init", session_id: sessionId, model });

const supportedModels = new Set(["default", "sonnet", "opus", "haiku", "fable"]);
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let input;
  try { input = JSON.parse(line); } catch { continue; }
  if (input.type === "control_request" && input.request?.subtype === "list_models") {
    emit({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: input.request_id,
        response: {
          models: [
            ...[...supportedModels].map((value) => ({
              value,
              resolvedModel: value === "default" ? "sonnet" : value,
              displayName: value === "default" ? "Default (recommended)" : `${value[0].toUpperCase()}${value.slice(1)}`,
            })),
            {
              value: "cc-update-required-1",
              resolvedModel: "cc-update-required-1",
              displayName: "Fable 5.1 (disabled)",
              description: "Update Claude Code to use Fable 5.1",
              disabled: true,
            },
          ],
        },
      },
    });
    continue;
  }
  if (input.type === "control_request" && input.request?.subtype === "set_model") {
    const requested = input.request.model;
    if (typeof requested === "string" && supportedModels.has(requested)) {
      model = requested;
      emit({ type: "control_response", response: { subtype: "success", request_id: input.request_id } });
    } else {
      emit({ type: "control_response", response: { subtype: "error", request_id: input.request_id, error: `Model ${JSON.stringify(requested)} is not available` } });
    }
    continue;
  }
  if (input.type !== "user") continue;
  const prompt = typeof input.message?.content === "string" ? input.message.content : "";
  const timestamp = new Date().toISOString();
  const userUuid = randomUUID();
  const assistantUuid = randomUUID();
  const user = {
    parentUuid, isSidechain: false, userType: "external", cwd: process.cwd(), sessionId,
    type: "user", uuid: userUuid, timestamp, message: { role: "user", content: prompt },
  };
  const assistant = {
    parentUuid: userUuid, isSidechain: false, cwd: process.cwd(), sessionId,
    type: "assistant", uuid: assistantUuid, timestamp: new Date().toISOString(),
    message: {
      id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", role: "assistant", model,
      content: [{ type: "text", text: `Mock Claude persisted: ${prompt}` }],
      stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
    },
  };
  await appendFile(transcriptPath, `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`);
  parentUuid = assistantUuid;
  emit({ ...assistant, session_id: sessionId });
  emit({ type: "result", subtype: "success", session_id: sessionId, is_error: false, result: assistant.message.content[0].text });
}
