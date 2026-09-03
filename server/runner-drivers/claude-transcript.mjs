function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function recordTimestamp(value, fallback = Date.now()) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function contentBlocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block?.type === "text") return [{ type: "text", text: String(block.text ?? "") }];
    if (block?.type === "thinking") return [{ type: "thinking", thinking: String(block.thinking ?? ""), ...(block.signature ? { thinkingSignature: block.signature } : {}) }];
    if (block?.type === "tool_use") return [{ type: "toolCall", id: String(block.id ?? "tool"), name: String(block.name ?? "tool"), arguments: block.input && typeof block.input === "object" ? block.input : {} }];
    if (block?.type === "image" && block.source?.type === "base64") return [{ type: "image", data: String(block.source.data ?? ""), mimeType: String(block.source.media_type ?? "application/octet-stream") }];
    return [];
  });
}

export function messageUsage(message, totalCost = 0) {
  const usage = message?.usage ?? {};
  const input = finite(usage.input_tokens);
  const output = finite(usage.output_tokens);
  const cacheRead = finite(usage.cache_read_input_tokens);
  const cacheWrite = finite(usage.cache_creation_input_tokens);
  return {
    input, output, cacheRead, cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: finite(totalCost) },
  };
}

function stopReason(reason) {
  return ({ end_turn: "stop", stop_sequence: "stop", max_tokens: "length", tool_use: "toolUse" })[reason] ?? "stop";
}

export function assistantMessage(record) {
  const message = record.message ?? {};
  return {
    role: "assistant",
    content: contentBlocks(message.content),
    api: "anthropic-messages",
    provider: "anthropic",
    model: String(message.model ?? record.model ?? "claude"),
    ...(message.id ? { responseId: message.id } : {}),
    usage: messageUsage(message, record.total_cost_usd),
    stopReason: record.error ? "error" : stopReason(message.stop_reason),
    ...(record.error ? { errorMessage: String(message.content?.[0]?.text ?? record.error) } : {}),
    timestamp: recordTimestamp(record.timestamp),
  };
}

export function claudeRecordMessages(record, toolNames = new Map()) {
  if (!record || typeof record !== "object" || record.isSidechain === true) return [];
  if (record.type === "assistant") {
    const message = assistantMessage(record);
    for (const block of message.content) if (block.type === "toolCall") toolNames.set(block.id, block.name);
    return [message];
  }
  if (record.type !== "user") return [];
  const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
  const results = blocks.filter((block) => block?.type === "tool_result").flatMap((block) => {
    const toolCallId = String(block.tool_use_id ?? "");
    if (!toolCallId) return [];
    const content = contentBlocks(block.content).filter((item) => item.type === "text" || item.type === "image");
    return [{
      role: "toolResult",
      toolCallId,
      toolName: toolNames.get(toolCallId) ?? "tool",
      content: content.length ? content : [{ type: "text", text: "" }],
      isError: block.is_error === true,
      timestamp: recordTimestamp(record.timestamp),
    }];
  });
  if (results.length) return results;
  const content = contentBlocks(record.message?.content).filter((item) => item.type === "text" || item.type === "image");
  return content.length ? [{ role: "user", content, timestamp: recordTimestamp(record.timestamp) }] : [];
}

export function parseClaudeJsonl(text) {
  const records = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && !Array.isArray(record)) records.push(record);
    } catch {
      // A poll can race an append. The next full reconciliation retries it.
    }
  }
  return records;
}

export function claudeRecordsToSessionEntries(records) {
  const entries = [];
  const toolNames = new Map();
  const leafByRecord = new Map();
  let latestLeaf = null;
  for (const record of records) {
    const sourceId = typeof record?.uuid === "string" && record.uuid ? record.uuid : null;
    if (!sourceId) continue;
    let parentId = typeof record.parentUuid === "string"
      ? (leafByRecord.get(record.parentUuid) ?? null)
      : latestLeaf;
    const messages = claudeRecordMessages(record, toolNames);
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const id = messages.length === 1 ? sourceId : `${sourceId}:${message.role}:${index}`;
      entries.push({
        type: "message",
        id,
        parentId,
        timestamp: new Date(recordTimestamp(record.timestamp, 0)).toISOString(),
        message,
      });
      parentId = id;
      latestLeaf = id;
    }
    // Non-message records still participate in Claude's UUID parent chain.
    leafByRecord.set(sourceId, parentId);
  }
  return entries;
}
