#!/usr/bin/env node
/**
 * Deterministic mock LLM for the oyster e2e suite.
 *
 * Speaks the OpenAI Chat Completions API (`POST /v1/chat/completions`,
 * streaming SSE + `[DONE]`, plus `GET /v1/models`) well enough for pi's
 * `openai-completions` provider, and returns HARDCODED responses so the
 * browser tests never depend on a real model or network.
 *
 * Response logic (see decide()):
 *   - A prompt that asks to expose something "on local port N" (the hublot
 *     background agent) -> one `bash` tool call that serves a
 *     "<button>Click me</button>" page on port N, then a short text reply on
 *     the follow-up turn (once a tool result is in the transcript).
 *   - "Reply with exactly the word X" (the checkpoint spec) -> the word X.
 *   - Anything else -> "OK".
 *
 * Config via env:
 *   PORT        listen port (default 4010)
 *   MODEL_ID    advertised model id (default "e2e-mock")
 *   MOCK_LOG    if set, append a JSONL request/response log here
 */

import http from "node:http";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 4010);
const MODEL_ID = process.env.MODEL_ID ?? "e2e-mock";
const LOG = process.env.MOCK_LOG || null;

function log(obj) {
  if (!LOG) return;
  try { appendFileSync(LOG, JSON.stringify(obj) + "\n"); } catch {}
}

// ---- helpers -------------------------------------------------------------

/** Flatten an OpenAI message `content` (string | array of parts) to text. */
function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
      .join(" ");
  }
  return "";
}

function allUserText(messages) {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => contentText(m.content))
    .join("\n");
}

/** Find the name of the bash/shell tool pi advertised (fallback "bash"). */
function bashToolName(tools) {
  if (!Array.isArray(tools)) return "bash";
  for (const t of tools) {
    const fn = t?.function ?? t;
    const name = fn?.name ?? "";
    const props = fn?.parameters?.properties ?? {};
    if (/bash|shell/i.test(name) || "command" in props) return name || "bash";
  }
  return "bash";
}

/** The bash command that serves the button page on `port`. */
function serveButtonCommand(port, startupPath) {
  // Honor the production setup-agent contract: create one idempotent startup
  // artifact at the allocated path and invoke that artifact (never start the
  // service directly from the agent tool call).
  return [
    `mkdir -p "$(dirname '${startupPath}')"`,
    `cat > '${startupPath}' <<'STARTUP'`,
    `#!/bin/sh`,
    `# oyster: idempotent`,
    `port=${port}`,
    `curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && exit 0`,
    `cat > /tmp/hublot-$port.js <<'JS'`,
    `const http = require('http');`,
    `const html = '<!doctype html><html><head><title>e2e button</title></head>' +`,
    `  '<body><button>Click me</button></body></html>';`,
    `http.createServer((q, s) => { s.writeHead(200, {'content-type': 'text/html'}); s.end(html); })`,
    `  .listen(Number(process.env.PORT));`,
    `JS`,
    `PORT=$port setsid nohup node /tmp/hublot-$port.js > /tmp/hublot-$port.log 2>&1 &`,
    `sleep 1`,
    `curl -fsS -o /dev/null "http://127.0.0.1:$port/"`,
    `STARTUP`,
    `chmod 700 '${startupPath}'`,
    `'${startupPath}' && echo "serving on $port"`,
  ].join("\n");
}

/** Decide the deterministic response for a request. */
function decide(messages, tools) {
  const userText = allUserText(messages);
  const hasToolResult = messages.some((m) => m.role === "tool");

  if (userText.includes("E2E_MAXWELL_KATEX")) {
    return { kind: "text", text: "$$\n\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}\n$$" };
  }

  if (userText.includes("E2E_PERSISTED_TOOL") && !hasToolResult) {
    return {
      kind: "tool",
      name: bashToolName(tools),
      arguments: { command: "printf persisted-tool-result" },
    };
  }

  // hublot background agent: "...available on local port N..." -> serve it,
  // unless we already ran the tool (then just finish with text).
  const portMatch = userText.match(/(?:local port|localhost:)\s*(\d+)/i);
  const wantsServe = /(serve|reachable|hublot|available on local port|forwards? to|keep running)/i.test(userText);
  if (portMatch && wantsServe && !hasToolResult) {
    const startupPath = userText.match(/at exactly\s+(\S+)/i)?.[1]?.replace(/[.,;:]$/, "");
    return {
      kind: "tool",
      name: bashToolName(tools),
      arguments: { command: serveButtonCommand(portMatch[1], startupPath ?? `/tmp/hublot-${portMatch[1]}-start.sh`) },
    };
  }
  if (hasToolResult) {
    return { kind: "text", text: "Done. The page is being served on the requested port." };
  }

  // checkpoint spec: "Reply with exactly the word ALPHA."
  const word = userText.match(/exactly(?:[: ]+the word)?[\s:"']+([A-Za-z][A-Za-z0-9_-]*)/i);
  if (word) return { kind: "text", text: word[1] };

  return { kind: "text", text: "OK" };
}

// ---- OpenAI wire format --------------------------------------------------

const nowSec = () => Math.floor(Date.now() / 1000);
const CHATCMPL = () => "chatcmpl-mock-" + Math.random().toString(36).slice(2, 10);

function chunk(id, delta, finish_reason = null) {
  return {
    id, object: "chat.completion.chunk", created: nowSec(), model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason }],
  };
}

function writeSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function streamResponse(res, decision) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const id = CHATCMPL();
  writeSSE(res, chunk(id, { role: "assistant" }));

  if (decision.kind === "text") {
    writeSSE(res, chunk(id, { content: decision.text }));
    writeSSE(res, chunk(id, {}, "stop"));
  } else {
    writeSSE(res, chunk(id, {
      tool_calls: [{
        index: 0, id: "call_" + Math.random().toString(36).slice(2, 10), type: "function",
        function: { name: decision.name, arguments: JSON.stringify(decision.arguments) },
      }],
    }));
    writeSSE(res, chunk(id, {}, "tool_calls"));
  }
  // usage as a final standalone chunk (harmless if pi ignores it)
  writeSSE(res, {
    id, object: "chat.completion.chunk", created: nowSec(), model: MODEL_ID,
    choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function jsonResponse(res, decision) {
  const id = CHATCMPL();
  const message = decision.kind === "text"
    ? { role: "assistant", content: decision.text }
    : {
        role: "assistant", content: null,
        tool_calls: [{
          id: "call_" + Math.random().toString(36).slice(2, 10), type: "function",
          function: { name: decision.name, arguments: JSON.stringify(decision.arguments) },
        }],
      };
  const body = {
    id, object: "chat.completion", created: nowSec(), model: MODEL_ID,
    choices: [{ index: 0, message, finish_reason: decision.kind === "text" ? "stop" : "tool_calls" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---- server --------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [{ id: MODEL_ID, object: "model", owned_by: "e2e-mock" }],
    }));
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(raw || "{}"); } catch {}
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const decision = decide(messages, payload.tools);
      log({ at: new Date().toISOString(), stream: !!payload.stream, in: messages.at(-1), decision });
      if (payload.stream) streamResponse(res, decision);
      else jsonResponse(res, decision);
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${url.pathname}` } }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-llm] listening on http://0.0.0.0:${PORT} (model ${MODEL_ID})`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
