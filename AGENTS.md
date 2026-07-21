# Agent guidelines for pi-lot-ui

## Bundled pi extensions

This repo ships the pi extensions that power its features in `extensions/`:

| File | Tool / command | What it does |
|---|---|---|
| `extensions/file-explorer.ts` | `/files` command + `ctrl+o` shortcut | Browse the workspace from the TUI, then edit or download any file. |
| `extensions/hublot.ts` | `hublot` tool | Open/close/list public web interfaces (cloudflared tunnels) for a session. |
| `extensions/routine.ts` | `routine` tool | Create/start/stop/teardown session-bound scripts with live progress reporting. |
| `extensions/goal-loop.ts` | `/goal-loop` + `goal_loop` tool | Execute a plan one verified commit at a time; full validation failures reset to the previous commit for retry. |

pi loads extensions from `~/.pi/agent/extensions/`. To make these bundled files
available (and keep them in sync with the repo), symlink or copy them:

```sh
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)"/extensions/*.ts ~/.pi/agent/extensions/   # symlink — edits here apply immediately
# or:
# cp extensions/*.ts ~/.pi/agent/extensions/              # copy — stable snapshot
```

Restart pi afterwards. The `hublot` and `routine` tools discover the UI server
from `PI_UI_URL` (default `http://127.0.0.1:8080`) and authenticate with
`PI_UI_TOKEN` or the `.ui-token` file next to `server.mjs`.

## Installation

This is a zero-dependency Node.js project — there is no install script, no build step, and no `npm install`.

### Prerequisites

- **Node.js ≥ 18** — check with `node --version`. LTS (20.x or 22.x) is recommended.
- **`pi` binary** — the [`pi` coding agent](https://github.com/badlogic/pi-mono) must be installed and on `PATH`. Install via npm: `npm install -g @earendil-works/pi-coding-agent` (or whatever package provides `pi`), then verify with `which pi`.
- **`cloudflared`** (optional) — only needed for the tunnels feature. Install from [pkg.cloudflare.com](https://pkg.cloudflare.com) if you plan to use tunnel functionality.

### Quick start

```bash
git clone <repo-url> pi-lot-ui && cd pi-lot-ui
node server.mjs
```

The server starts on `0.0.0.0:8080` and prints a random auth token to the console. On first run it also writes that token to `.ui-token` (git-ignored) so subsequent restarts keep the same token.

Open `http://<host>:8080/#token=<TOKEN>` in your browser. The URL fragment also gets passed as your bearer token for API calls.

### Configuration

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--port` | `PORT` | `8080` | listen port |
| `--host` | `HOST` | `0.0.0.0` | bind address |
| `--token` | `PI_UI_TOKEN` | `.ui-token` file, else random | auth token |
| `--dir` | `PI_DIR` | cwd | working directory pi runs in |
| `--pi` | `PI_BIN` | `pi` | pi executable path |
| `--pi-args "…"` | `PI_ARGS` | – | extra args appended to `pi --mode rpc` |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | binary for opening tunnels |

### Running as a service

A systemd user unit is provided as `pi-ui.service`: it auto-restarts on crash and starts on login. Before using it, update the hardcoded `WorkingDirectory=` and `ExecStart=` paths to match your clone location:

```bash
sed "s|__PI_UI_DIR__|$(pwd)|g" pi-ui.service > ~/.config/systemd/user/pi-ui.service
systemctl --user daemon-reload
systemctl --user enable --now pi-ui.service
sudo loginctl enable-linger $USER   # keep running without an active login session
```

Logs: `journalctl --user -u pi-ui -f`.

For a backgrounded foreground process instead:

```bash
nohup node server.mjs > /tmp/pi-ui.log 2>&1 &
```

## Run the tests after every feature or fix

After implementing a feature or fixing a bug, run:

```sh
npm test
```

and make sure **all** tests pass before you consider the work done.

Why this is non-negotiable in this repo: the server hot-reloads `app.mjs` and
`public/index.html` **the moment you save them** — every edit deploys
instantly to live browser sessions. There is no build step or review gate to
catch mistakes. A single stale reference in the UI's inline script (e.g. a
top-level `$("removedElement").addEventListener(...)`) aborts the whole
script and takes down the page for everyone connected.

The suite is fast (<1s). It includes guards that specifically catch
hot-reload footguns:

- `tests/ui-page.test.mjs` — the inline script must parse, and every DOM id
  it references must exist in the markup. If you remove or rename an element
  in `index.html`, remove or update the code that references it.
- `tests/sessions.test.mjs`, `tests/checkpoints.test.mjs` — server-side
  behavior.

When you add a feature, prefer adding a test alongside it — especially for
anything in `app.mjs` request handling, where a regression silently breaks
remote clients.

## Editing `public/index.html`

- The whole UI is one file with one inline `<script>`. Top-level statements
  run at load; if any of them throw, the page is dead. Guard optional
  elements (`$("x")?.addEventListener(...)`) or wire listeners inside the
  code that creates the element.
- Saving the file broadcasts `ui_reload` to connected browsers, which may
  refresh immediately. Don't save half-finished states; make edits atomic.

## Editing `app.mjs`

- Hot-reloaded via `init(state)`. All state that must survive a reload
  (runners, SSE clients, buffers, tunnels) lives on the host-owned `state`
  object from `server.mjs` — never in module-level variables.
- If a reload fails to parse, the server keeps the previous version running
  and broadcasts `code_reload_failed`; check the journal
  (`journalctl --user -u pi-ui`) if your change doesn't seem to apply.
