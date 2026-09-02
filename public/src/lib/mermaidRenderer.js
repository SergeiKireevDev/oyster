const SECURE_MERMAID_CONFIG_KEYS = Object.freeze([
  "securityLevel",
  "secure",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "theme",
  "themeVariables",
  "themeCSS",
  "fontFamily",
  "altFontFamily",
  "dompurifyConfig",
]);

function mermaidTheme(rootElement) {
  return rootElement?.getAttribute?.("data-theme") === "light" ? "default" : "dark";
}

function mermaidConfig(theme) {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    secure: [...SECURE_MERMAID_CONFIG_KEYS],
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    maxEdges: 500,
    theme: theme === "default" ? "default" : "dark",
  };
}

async function loadMermaid() {
  const module = await import("mermaid");
  return module.default ?? module;
}

export async function renderMermaidDiagrams(sources, {
  theme = mermaidTheme(globalThis.document?.documentElement),
  loader = loadMermaid,
} = {}) {
  const mermaid = await loader();
  mermaid.initialize(mermaidConfig(theme));
  const renderBatch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const results = [];

  for (let index = 0; index < sources.length; index++) {
    try {
      const id = `oyster-mermaid-${renderBatch}-${index}`;
      const rendered = await mermaid.render(id, String(sources[index] ?? ""));
      if (typeof rendered?.svg !== "string" || !/^\s*<svg(?:\s|>)/i.test(rendered.svg)) {
        throw new Error("Mermaid did not return an SVG document");
      }
      results.push({ status: "rendered", svg: rendered.svg });
    } catch {
      results.push({ status: "error" });
    }
  }

  return results;
}

export function createMermaidResultsStore(sources, options = {}) {
  const diagrams = Array.from(sources ?? [], (source) => String(source ?? ""));
  return {
    subscribe(publish) {
      let active = true;
      if (!diagrams.length) {
        publish([]);
        return () => { active = false; };
      }
      publish(diagrams.map(() => ({ status: "loading" })));
      void renderMermaidDiagrams(diagrams, options).then((results) => {
        if (active) publish(results);
      }).catch(() => {
        if (active) publish(diagrams.map(() => ({ status: "error" })));
      });
      return () => { active = false; };
    },
  };
}

export { SECURE_MERMAID_CONFIG_KEYS, mermaidConfig, mermaidTheme };
