/** Copy text with a DOM fallback for browsers without Clipboard API permission. */
export async function copyTextToClipboard(text, { clipboard = globalThis.navigator?.clipboard, documentTarget = globalThis.document } = {}) {
  try {
    if (!clipboard) throw new Error("clipboard unavailable");
    await clipboard.writeText(text);
    return true;
  } catch {
    if (!documentTarget) return false;
    const textarea = documentTarget.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;opacity:0";
    documentTarget.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = documentTarget.execCommand("copy"); } catch {}
    textarea.remove();
    return copied;
  }
}
