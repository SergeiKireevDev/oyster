/** Translate AGY's documented NDJSON stream into the common Gemini-shaped events. */
export function antigravityEvents(runtime, record) {
  if (record.event === "init") return antigravityInitEvent(runtime, record);
  if (record.event === "step_update") return antigravityStepEvents(runtime, record.step_update ?? {});
  if (record.event === "result") return antigravityResultEvents(runtime, record.result ?? {});
  return [];
}

function antigravityInitEvent(runtime, record) {
  runtime.agySteps = new Set();
  runtime.agyText = "";
  return [{ type: "init", session_id: record.conversation_id, model: record.init?.model ?? runtime.model }];
}

function antigravityStepEvents(runtime, step) {
  if (step.step_type === "agent_response") return antigravityTextEvents(runtime, step);
  if (step.step_type === "tool") return antigravityToolEvents(runtime, step);
  return [];
}

function antigravityTextEvents(runtime, step) {
  const text = String(step.text_delta ?? "");
  runtime.agyText = (runtime.agyText ?? "") + text;
  return text ? [{ type: "message", role: "assistant", content: text }] : [];
}

function antigravityToolEvents(runtime, step) {
  const id = `${step.conversation_id ?? runtime.sessionId}:${step.step_index}`;
  const info = step.tool_info ?? {};
  const events = [];
  runtime.agySteps ??= new Set();
  if (!runtime.agySteps.has(id)) {
    runtime.agySteps.add(id);
    events.push({ type: "tool_use", tool_id: id, tool_name: info.name ?? step.tool_name ?? "tool", parameters: info.parameters ?? {} });
  }
  if (step.state === "DONE" && !runtime.agySteps.has(`${id}:done`)) {
    runtime.agySteps.add(`${id}:done`);
    events.push({ type: "tool_result", tool_id: id, output: info.output ?? info.error?.message ?? "", status: info.error ? "error" : "success" });
  }
  return events;
}

function antigravityResultEvents(runtime, result) {
  const events = [];
  if (!runtime.agyText && result.response) events.push({ type: "message", role: "assistant", content: String(result.response) });
  events.push({ type: "result", status: result.status === "SUCCESS" ? "success" : "error", error: { message: result.error ?? `Antigravity run ended with ${result.status ?? "unknown status"}` } });
  return events;
}
