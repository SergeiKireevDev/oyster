# pi-lot-ui

A small web UI for driving the [pi coding agent](https://github.com/badlogic/pi-mono) remotely — from a phone or any browser — through a tunnel.

```
browser ──HTTP/SSE──> server.mjs ──stdin/stdout JSONL──> pi --mode rpc (one per open session)
```

The stable core (`server.mjs`) owns everything that must survive a hot
reload (socket, SSE clients, child processes); `app.mjs` is the router and
is re-imported on change, pulling in the domain modules with cache-busted
imports: `runners.mjs` (pi processes), `sessions.mjs` (.jsonl parsing,
mtime-cached), `checkpoints.mjs` (git checkpoints/rollback),
`tunnels.mjs` (cloudflared + hublot agents), `routines.mjs` (scripts).

### Hot reload scope

The stable core watches `app.mjs` and the HTTP route modules under `http/`.
During development or runtime recovery, changes are loaded with mtime query
parameters and the complete route table is constructed before the active
handler is swapped. A failed import or construction leaves the previous
handler and existing SSE connections running. Each successful reload creates
new ESM cache entries, so this mechanism is not intended as a production
rollout strategy: production deployments should replace the Node process to
bound module-cache growth and guarantee a clean application version.

- **Zero dependencies** — plain Node ≥ 18, no `npm install`. Tests: `npm test` (node --test).
- **Tunnel-friendly** — uses Server-Sent Events + POST instead of WebSockets, so it works through any plain HTTP tunnel or reverse proxy (sends `X-Accel-Buffering: no` for nginx).
- **Token auth** — every API request requires a bearer token; the static page itself carries no secrets.

## Bundled pi extensions

This repo ships the pi extensions that power its features in `extensions/`:

| File | Tool / command | What it does |
|---|---|---|
| `extensions/file-explorer.ts` | `/files` command + `ctrl+o` shortcut | Browse the workspace from the TUI, then edit or download any file. |
| `extensions/hublot.ts` | `hublot` tool | Open/close/list public web interfaces (cloudflared tunnels) for a session. |
| `extensions/routine.ts` | `routine` tool | Create/start/stop/teardown session-bound scripts with live progress reporting. |

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

## Quick start

Build the SQLite-enabled development checkout once, then start the UI:

```sh
cd /home/ubuntu/pi-coding-agent && npm run build
cd /home/ubuntu/tree-pi-bak-sql && node server.mjs
```

Development defaults to
`/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js` with
`PERSISTENT_STORE=sqlite`. The server refuses to start if that executable is
missing/stale, if SQLite is selected on Node older than 22.19, or if the store
value is invalid. SQLite sessions are stored in
`~/.pi/agent/sessions.sqlite` by default (or `sessions.sqlite` under
`PI_CODING_AGENT_DIR`/`--session-dir`).

To use the JSONL rollback mode without migrating or modifying either store:

```sh
PERSISTENT_STORE=jsonl PI_BIN=/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js node server.mjs
```

Then open `http://<host>:8080/#token=<TOKEN>` — the token is stored in the browser's localStorage and stripped from the URL. Without a token in the URL the UI shows a token prompt.

## Configuration

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--port` | `PORT` | `8080` | listen port |
| `--host` | `HOST` | `0.0.0.0` | bind address |
| `--token` | `PI_UI_TOKEN` | `.ui-token` file, else random | auth token |
| `--dir` | `PI_DIR` | cwd | working directory pi runs in |
| `--pi` | `PI_BIN` | local checkout `dist/cli.js` | pi executable; bare names are resolved through `PATH` |
| – | `PERSISTENT_STORE` | `sqlite` | session backend: `sqlite` or `jsonl` |
| – | `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi agent directory; SQLite database is `<dir>/sessions.sqlite` |
| `--pi-args "…"` | `PI_ARGS` | – | extra args appended to `pi --mode rpc`; `--session-dir <dir>` relocates `sessions.sqlite` |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | binary used to open tunnels (must support `tunnel --url http://127.0.0.1:<port>`) |

A `.ui-token` file next to `server.mjs` (one line, the token) keeps the token stable across restarts. It is git-ignored.

`npm test` includes a process-level contract against the exact local pi path:
it creates a SQLite conversation with an offline mock model, stops pi, and
restores the same session with `--continue`. Environments intentionally testing
the published JSONL fallback (the current release-image build path) must opt out
explicitly with `PI_SQLITE_CONTRACT_TEST=skip`; the test never substitutes a
global `pi` binary silently.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | no | the UI (static, secret-free) |
| `GET /health` | no | liveness plus active pi executable/backend/database diagnostics (never tokens or credentials) |
| `GET /events` | yes | SSE stream of pi's stdout (events + responses), with replay of recent lines |
| `POST /rpc` | yes | JSON body forwarded verbatim to pi's stdin |
| `POST /restart` | yes | kill and respawn the pi process |
| `GET /tunnels` | yes | list live tunnels spawned by this server |
| `POST /tunnels` | yes | open a tunnel for a local port: `{ "port": 3000, "label": "…" }` → replies with the public URL |
| `DELETE /tunnels?id=…` | yes | close a tunnel |
| `GET /routines` | yes | list runnable scripts in `~/.pi/routines/` with live run state and session bindings |
| `POST /routines` | yes | drive a routine: `{ "name": "build.sh", "action": "start" \| "stop" \| "teardown" \| "release", "sessionId": "…" }` |

Auth = `Authorization: Bearer …`, `X-Auth-Token` header, or `pi_ui_token`
cookie; `?token=…` is accepted on **GET requests only** (EventSource and
download links can't send headers) — mutating requests must use a header or
cookie. Repeated failures are rate-limited per client IP. File endpoints
(`/browse`, `/file-*`, `/mkdir`, `/workdir`) are confined to `$HOME`, `/tmp`
and the configured workdir, with credential stores (`~/.ssh`, `~/.aws`, …)
denied.

## UI features

- Streaming assistant output with markdown rendering, collapsible **thinking** blocks, and per-tool-call cards (args, live partial output, result, error state).
- Send prompts (Enter), steer mid-stream (send while streaming), **Stop** to abort.
- Model picker, thinking-level cycling, new session, context compaction, pi process restart — from the header chips / ☰ menu.
- **Tunnels** — ☰ → *Tunnels…* opens a modal listing live tunnels and lets you spawn a new one deterministically for the current session: pick a local port, describe *what the agent should expose through it*, and (by default) the UI briefs the agent with the public URL and that description so it starts the right server on that port. Tunnels are cloudflared quick tunnels by default (`--tunnel-bin` to change), survive server code hot-reloads, and are killed on shutdown. Requires [`cloudflared`](https://pkg.cloudflare.com) (or an equivalent tool) to be installed.
- **Checkpoints** — an iceberg button (🧊) rides on the latest message of the transcript; tapping it opens a model picker, then commits every pending change in the session's workdir (`git add -A && git commit`), freezing the state the conversation reached at that point (a clean workdir is marked at HEAD instead). Pick a model and a one-shot pi sub-agent (`--no-session --no-tools -p`) summarizes the staged diff into the commit message (`checkpoint: <summary>`); pick *no summary* (or if the sub-agent fails) and it falls back to a `checkpoint <timestamp>` message. The last-used model is remembered and offered first. Checkpoints are anchored to the message they were taken at and persisted in `~/.pi/agent/checkpoints.json`. Every checkpointed message then carries a return arrow (↩) and an icy accent on its bubble so rollbackable messages stand out at a glance: tapping ↩ opens the same model modal (the summary applies to the pending changes that get auto-committed first, so nothing is ever lost), then deterministically rolls the workdir back to that commit via `git reset --hard` and automatically opens a **forked session** whose history ends at that message (the fork inherits the ancestors' checkpoint markers, so you can hop between states freely, including back "forward" to the auto-saved tip). No LLM is involved anywhere. The 🌳 header chip toggles a right sidebar visualising the whole family as a tree: the session's root ancestor, every fork nested under the checkpoint it was created from (🌱 root · 🌿 forks, with live/busy dots), and each session's 🧊 checkpoints — tap a session to switch to it, tap a checkpoint to roll back and fork right from the sidebar. Forks are born named `⏪ <hash>` and automatically take a short title from the first message you send them (`⏪ make the login page blue…`), so they read like what they went on to do. The sessions picker keeps things tidy too: forked sessions are collapsed under their main session (🌿 *n forks*), and a whole fork family counts as “active” if any member has a live process.
- **Routines** — a second sidebar section lists runnable scripts from the global store `~/.pi/routines/` (any executable file). Starting one **binds it to the current session**: it runs in that session's workdir, other sessions can't start it until it is **released**, and the binding (plus workdir) is persisted in `~/.pi/routines/bindings.json` so teardown finds the byproducts even across server restarts. Each routine can be **started** (`<script> run`), **stopped** (SIGTERM/SIGKILL to its process group) and **torn down** (`<script> teardown`, expected to remove the run's byproducts); deleting a session stops and releases its routines. Routines natively report progression: any stdout line of the form `::progress <0-100> <message>` drives a live progress bar and status message in the sidebar; other output is kept as a log tail (hover the message). Terminal states (finished / failed / stopped / torn down) surface as toasts.
- Extension UI bridge: pi extensions that ask for confirm/select/input get a modal in the browser; notifications become toasts.
- Reconnects automatically (EventSource); recent events are replayed on reconnect so a page refresh mid-run doesn't lose context.
- Mobile-friendly layout.

## Running it in the background

```sh
PI_UI_TOKEN=$(cat .ui-token) nohup node server.mjs > /tmp/pi-ui.log 2>&1 &
```

or a systemd user unit if you want it supervised.

## Tunnel notes

Anything that forwards plain HTTP to port 8080 works, e.g.:

```sh
cloudflared tunnel --url http://localhost:8080
ssh -R 80:localhost:8080 nokey@localhost.run
```

The token is your only line of defense once tunneled — treat the URL-with-token like a password.

## Running as a service

A systemd user unit keeps the UI alive across crashes and logouts:

```sh
cp pi-ui.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-ui.service
sudo loginctl enable-linger ubuntu   # keep it running with no active login session
```

The token comes from `.ui-token` next to `server.mjs`. Logs: `journalctl --user -u pi-ui -f`.
