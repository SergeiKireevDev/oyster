# oyster end-to-end tests (Playwright)

Browser-driven e2e tests that exercise the real UI against a oyster **docker
container on port 4000**. Each spec covers one feature. The container runs a
**bundled deterministic mock LLM** (see `mock-llm/`), so the whole stack —
UI + agent + model — is **self-contained in the image: no credential mounts,
no network model calls, fully deterministic**.

| Spec | Scenario |
|---|---|
| `pinned-widgets.spec.js` | Open native artifact widgets, create a managed **live-interface widget** for a button service, drag it into a group with desktop or long-press touch input, assert it uses a status tile without an iframe, and preserve the mobile widget drawer through operations. |
| `routine.spec.js` | Start a session → create a **dummy routine** in the store → ▶ run it from the sidebar to completion → 🧹 tear it down. |
| `checkpoint-rollback.spec.js` | Start a session in a git repo → commit changes, **freeze** (🧊) → recommit, freeze again → **roll back** (↩) to the first checkpoint into a forked session. |
| `sessions.spec.js` | **Session management**: start sessions and ■ **stop** a session's background process; **switch** between sessions and confirm the transcript follows; **search** across sessions and jump to a highlighted hit; autocomplete composer paths and fall back to the file explorer for large result sets. |
| `sqlite-container-persistence.spec.js` | Create a SQLite conversation, replace the container on its isolated agent volume, and verify picker/search/transcript resume with no JSONL files. |
| `transcript-rendering.spec.js` | Verify agent display math renders through KaTeX and completed historical SQLite tool calls remain completed after tail-first transcript reload. |
| `hub.spec.js` | Start the ordinary isolated Docker spoke plus a temporary Hub process, connect through the Hub interface with one shared token file, and verify workspace-scoped mobile session creation. |

## Prerequisites

- Docker. Every scenario uses the `oyster:sqlite` image. The suite builds it
  automatically with `Dockerfile.local-pi` and the repository's `pi` submodule
  when it is missing (override the source with `PI_SOURCE_CONTEXT`).
- Node ≥ 22.19 (the server always uses the built-in `node:sqlite` application store).

The image bundles a mock LLM, so no host credentials or external model access
are needed. `global-setup.js` starts each container with `E2E_MOCK_LLM=1`,
`E2E_MOCK_TUNNELS=1`, `PERSISTENT_STORE=sqlite`, and a fresh named volume
at `/home/node/.pi/agent`. The image runs Oyster as the unprivileged `node` user. Set `E2E_MOCK_TUNNELS=0` in a persistent test/staging
container to retain the deterministic model while using real Cloudflare Quick
Tunnels.
The SQLite persistence scenario retains that volume across deliberate container
replacement; every test removes its volume during teardown.

## Run

```bash
cd tests/e2e
npm install
npx playwright install chromium   # one-time browser download
npm test                           # runs with three workers by default
```

The standard E2E run uses **three Playwright workers** to bound the memory used by
SQLite-backed pi containers. Override concurrency only
when needed for a constrained host or focused debugging, for example
`E2E_WORKERS=1 npm test`.

### Hosts without root (can't `sudo apt-get install`)

Playwright's Chromium normally needs system libraries installed with root. On a
locked-down host (e.g. Debian trixie, no passwordless sudo) run the bundled
rootless setup instead — it `apt-get download`s the libs + a font (no root) into
`~/.pw-syslibs`, which `playwright.config.js` auto-detects to run
`chrome-headless-shell`:

```bash
bash setup-browser-libs.sh
npx playwright install chromium
npm test
```

Each test starts a throwaway container and isolated agent volume on an allocated
port. Both are removed on teardown. The Hub spec additionally starts a temporary
Hub on a free host port; its mock driver points at that test's real Docker spoke,
and both interfaces read the same test token.

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `OYSTER_URL` | `http://localhost:4000` | UI base URL |
| `OYSTER_TOKEN` | `e2e-test-token` | auth token |
| `OYSTER_IMAGE` | `oyster:sqlite` | local-source SQLite image used by every scenario |
| `PI_SOURCE_CONTEXT` | `<repository>/pi` | named BuildKit source used when the SQLite image must be built |
| `OYSTER_CONTAINER` | allocated per test | name for a container the suite starts |
| `E2E_WORKERS` | `3` | Playwright worker count; tune it for the host's available memory |

## Notes

- Specs run in parallel with **three workers by default**. Product specs isolate
  themselves by starting a fresh mock container in `beforeEach` and removing it
  in `afterEach`, so workspace/session state does not leak between scenarios.
- The Pinned Widgets spec exercises the compatibility tunnel lifecycle behind
  a live-interface widget. The bundled mock serves its button page
  deterministically in seconds without external model calls. Per-test timeout
  is 6 min.
- `npx playwright show-report` opens the HTML report after a run.
- `video-*.example.js` files are scratch/manual video-recording examples. They
  intentionally do not match Playwright's `*.spec.js` pattern and are not part
  of the product e2e suite.

### Determinism

`mock-llm/server.mjs` is an OpenAI Chat Completions-compatible endpoint that
returns hardcoded responses:
- `"Reply with exactly the word X"` → `X` (checkpoint spec seed prompts).
- a prompt to expose something "on local port N" → a single `bash` tool call
  that serves a `<button>Click me</button>` page on port N, then text.
- anything else → `OK`.
