export function summarizeToolArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  const first = Object.values(args).find((value) => typeof value === "string");
  return first || "";
}

export function toolResultText(msg) {
  if (!msg) return "";
  const parts = [];
  const content = msg.content;
  if (typeof content === "string") parts.push(content);
  else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "text") parts.push(item.text);
      else if (item.type === "image") parts.push(`[image ${item.mimeType}]`);
    }
  }
  return parts.join("\n");
}

export function userMessageText(message) {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  }
  return "";
}

/** Extract the authored assistant response without thinking or tool-call UI. */
export function assistantMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n\n");
}

export function shouldShowThinking(localStorageLike = globalThis.localStorage) {
  return localStorageLike?.getItem?.("pi_show_thinking") !== "0";
}

export function messageEntryMatchesElement(entry, el) {
  if (entry.role !== el.dataset.role) return false;
  const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const text = norm(entry.text ?? "");
  if (!text || text.startsWith("[")) return true;
  return norm(el.textContent).includes(text.slice(0, 60));
}
