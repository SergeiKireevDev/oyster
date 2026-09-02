import test from "node:test";
import assert from "node:assert/strict";
import {
  SECURE_MERMAID_CONFIG_KEYS,
  createMermaidResultsStore,
  mermaidConfig,
  mermaidTheme,
  renderMermaidDiagrams,
} from "../public/src/lib/mermaidRenderer.js";

test("Mermaid renderer locks security-sensitive configuration", () => {
  const config = mermaidConfig("default");
  assert.equal(config.securityLevel, "strict");
  assert.equal(config.startOnLoad, false);
  assert.equal(config.suppressErrorRendering, true);
  assert.equal(config.theme, "default");
  assert.equal(config.maxTextSize, 50_000);
  assert.equal(config.maxEdges, 500);
  for (const key of ["securityLevel", "secure", "themeCSS", "dompurifyConfig", "maxTextSize", "maxEdges"]) {
    assert.ok(SECURE_MERMAID_CONFIG_KEYS.includes(key));
    assert.ok(config.secure.includes(key));
  }
});

test("Mermaid renderer renders diagrams independently and validates SVG results", async () => {
  let initialized;
  const calls = [];
  const mermaid = {
    initialize(config) { initialized = config; },
    async render(id, source) {
      calls.push({ id, source });
      if (source === "invalid") throw new Error("syntax error");
      if (source === "not-svg") return { svg: "<div>wrong output</div>" };
      return { svg: `<svg role="graphics-document"><text>${source}</text></svg>` };
    },
  };

  const results = await renderMermaidDiagrams(["graph TD", "invalid", "not-svg"], {
    theme: "dark",
    loader: async () => mermaid,
  });

  assert.equal(initialized.securityLevel, "strict");
  assert.equal(initialized.theme, "dark");
  assert.deepEqual(results.map(({ status }) => status), ["rendered", "error", "error"]);
  assert.match(results[0].svg, /^<svg/);
  assert.deepEqual(calls.map(({ source }) => source), ["graph TD", "invalid", "not-svg"]);
  assert.ok(calls.every(({ id }, index) => id.endsWith(`-${index}`)));
});

test("Mermaid result stores publish loading and rendered states", async () => {
  const states = [];
  let finish;
  const rendered = new Promise((resolve) => { finish = resolve; });
  const store = createMermaidResultsStore(["graph TD"], {
    loader: async () => ({
      initialize() {},
      render: async () => rendered,
    }),
  });
  const completed = new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      states.push(state);
      if (state[0]?.status === "rendered") {
        unsubscribe();
        resolve();
      }
    });
  });
  assert.equal(states[0][0].status, "loading");
  finish({ svg: "<svg><text>done</text></svg>" });
  await completed;
  assert.equal(states.at(-1)[0].status, "rendered");
});

test("Mermaid theme follows the application root", () => {
  const root = { getAttribute: (name) => name === "data-theme" ? "light" : null };
  assert.equal(mermaidTheme(root), "default");
  assert.equal(mermaidTheme(null), "dark");
  assert.equal(mermaidConfig("unknown").theme, "dark");
});
