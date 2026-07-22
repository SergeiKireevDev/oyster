/** Split composer text into plain text, fence markers, and fenced code. */
export function composerHighlightSegments(text) {
  const source = String(text ?? "");
  const segments = [];
  let position = 0;
  let inCode = false;

  while (position < source.length) {
    const fence = source.indexOf("```", position);
    if (fence === -1) {
      segments.push({ type: inCode ? "code" : "text", text: source.slice(position) });
      break;
    }
    if (fence > position) {
      segments.push({ type: inCode ? "code" : "text", text: source.slice(position, fence) });
    }
    segments.push({ type: "fence", text: "```" });
    inCode = !inCode;
    position = fence + 3;
  }

  return segments;
}
