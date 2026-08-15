const SHELL_KEYWORDS = new Set([
  "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "select", "then", "until", "while",
  "alias", "cd", "declare", "echo", "exec", "exit", "export", "local", "printf", "read", "return", "set", "shift", "source", "sudo", "test", "trap", "unset",
]);

const SHELL_TOKEN = /#[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|`(?:\\.|[^`\\])*`|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|&&|\|\||;;|[|;&<>]|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_-]*/g;

function tokenType(token) {
  const first = token[0];
  if (first === "#") return "com";
  if (first === '"' || first === "'" || first === "`") return "str";
  if (first === "$") return "var";
  if (first >= "0" && first <= "9") return "num";
  if (SHELL_KEYWORDS.has(token)) return "kw";
  if (/^(?:&&|\|\||;;|[|;&<>])$/.test(token)) return "op";
  return null;
}

export function highlightShellSegments(source) {
  const text = String(source ?? "");
  const segments = [];
  let position = 0;
  SHELL_TOKEN.lastIndex = 0;
  for (let match = SHELL_TOKEN.exec(text); match; match = SHELL_TOKEN.exec(text)) {
    if (match.index > position) segments.push({ start: position, text: text.slice(position, match.index), type: null });
    segments.push({ start: match.index, text: match[0], type: tokenType(match[0]) });
    position = match.index + match[0].length;
  }
  if (position < text.length) segments.push({ start: position, text: text.slice(position), type: null });
  return segments;
}
