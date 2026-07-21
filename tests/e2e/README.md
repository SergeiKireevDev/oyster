# pi-lot-ui end-to-end tests (Playwright)

Browser-driven e2e tests that exercise the real UI against a pi-lot-ui **docker
container on port 4000**. Each spec covers one feature. The container runs a
**bundled deterministic mock LLM** (see `mock-llm/`), so the whole stack —
UI + agent + model — is **self-contained in the image: no credential mounts,
no network model calls, fully deterministic**.

| Spec | Scenario |
|---|---|
| `hublot.spec.js` | Start a session → open a hublot for a simple **button interface** (background agent builds it, real cloudflared tunnel) → assert the button is served → close it. |
| `routine.spec.js` | Start a session → create a **dummy routine** in the store → ▶ run it from the sidebar to completion → 🧹 tear it down. |
| `checkpoint-rollback.spec.js` | Start a session in a git repo → commit changes, **freeze** (🧊) → recommit, freeze again → **roll back** (↩) to the first checkpoint into a forked session. |
| `sessions.spec.js` | **Session management**: start sessions and ■ **stop** a session's background process; **switch** between sessions and confirm the transcript follows; **search** across sessions and jump to a highlighted hit; use a **":" prompt command** (command palette) to open the file picker. |

## Prerequisites

- Docker with the `pi-lot-ui` image built (`docker build -t pi-lot-ui .` in the
  repo root). The suite builds it automatically if missing.
- Node ≥ 18.

The image bundles a mock LLM, so no host credentials or external model access
are needed — `global-setup.js` starts the container with `E2E_MOCK_LLM=1` and
nothing is mounted.

## Run

```bash
cd tests/e2e
npm install
npx playwright install chromium   # one-time browser download
npm test
```

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

`global-setup.js` will **reuse** any container already serving `:4000` with the
token `e2e-test-token` (e.g. your running `pi-lot-ui-test`); otherwise it starts
a throwaway `pi-lot-e2e` container and removes it on teardown.

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `PI_UI_URL` | `http://localhost:4000` | UI base URL |
| `PI_UI_TOKEN` | `e2e-test-token` | auth token |
| `PI_UI_IMAGE` | `pi-lot-ui` | image to run if nothing is on :4000 |
| `PI_UI_CONTAINER` | `pi-lot-e2e` | name for a container the suite starts |

## Notes

- Specs run **sequentially** (one worker). Product specs isolate themselves by
  starting a fresh mock container in `beforeEach` and removing it in
  `afterEach`, so workspace/session state does not leak between scenarios.
- The hublot spec opens a real cloudflared tunnel; the bundled mock serves
  the button page deterministically in seconds (a real model would take
  minutes). with the bundled mock the button
  page is served deterministically in seconds. Per-test timeout is 6 min.
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
