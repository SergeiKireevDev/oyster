# pi-lot-ui

A small web UI for driving the [pi coding agent](https://github.com/badlogic/pi-mono) remotely — from a phone or any browser — through a tunnel.

```
browser ──HTTP/SSE──> server.mjs ──stdin/stdout RPC──> pi --mode rpc (one per open session)
                              │
                              └── session catalog ──> SQLite or JSONL
```

### Runtime and session architecture

The stable core (`server.mjs`) validates the configured pi executable and
persistence store once, then owns everything that must survive a hot reload:
the socket, SSE clients, catalog lifecycle, centralized pi process launcher,
and child processes. `app.mjs` is the replaceable router and composes the HTTP
routes with `runners.mjs`, `checkpoints.mjs`, `tunnels.mjs`, and `routines.mjs`.

`sessions.mjs` selects a backend-neutral catalog. SQLite discovery and
transcript reads use request-scoped, read-only `node:sqlite` handles in
`sessions/sqliteCatalog.mjs`; JSONL parsing and its mtime/LRU cache live only in
`sessions/jsonlCatalog.mjs`. Workflow mutations are never issued as SQL by this
server: SQLite delete and exact-entry fork delegate to repository operations
shipped with the configured pi CLI.

A persisted session is represented internally by `{ backend, id, storagePath }`
and serialized as an opaque `ps1_…` session key. For SQLite, `storagePath` is
the shared database and `id` distinguishes sessions; the database path alone
is never an identity. `sessionFile` and path query parameters exist only as
JSONL compatibility fields for older links and clients.

### Hot reload scope

The stable core watches `app.mjs` and the HTTP route modules under `http/`.
During development or runtime recovery, changes are loaded with mtime query
parameters and the complete route table is constructed before the active
handler is swapped. A failed import or construction leaves the previous
handler and existing SSE connections running. Each successful reload creates
new ESM cache entries, so this mechanism is not intended as a production
rollout strategy: production deployments should replace the Node process to
bound module-cache growth and guarantee a clean application version.

- **Minimal runtime** — Node ≥ 22.19 is universally required because the stable server uses `node:sqlite` for pi-lot-ui application data, including when pi sessions use JSONL. No npm SQLite driver is used. Tests: `npm test`.
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
missing/stale, when Node is older than 22.19, or if the store value is invalid. SQLite sessions are stored in
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
| – | `PI_UI_DB_PATH` | `~/.pi/agent/pi-lot-ui.sqlite` | separate SQLite database for pi-lot-ui-owned application data |
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
| `POST /restart` | yes | kill and respawn one selected runner (`?runner=…`) |
| `GET /runners` / `DELETE /runners?id=…` | yes | list runners or stop one runner |
| `POST /open-session` | yes | create/resume a runner using `{ "sessionKey": "ps1_…", "dir": "…" }`; legacy `sessionPath` remains JSONL-only compatibility input |
| `GET /sessions` | yes | list catalog summaries with canonical `sessionKey` and `sessionRef`; optional `dir` scopes the catalog |
| `GET /session-by-id` | yes | resolve a saved session by `key=ps1_…` (legacy `id`/path lookup is accepted for JSONL) |
| `GET /session-entries` / `GET /session-messages` | yes | read durable active-branch entries/messages selected by `key=ps1_…` |
| `GET /session-folders` / `GET /search` | yes | discover workdirs and search durable sessions; search results carry opaque session keys |
| `DELETE /session?key=ps1_…` | yes | delete through the selected backend capability; SQLite never unlinks the shared database |
| `GET /checkpoints` / `GET /checkpoint-tree` | yes | read checkpoint state using an opaque session key |
| `POST /checkpoint` / `POST /rollback` | yes | record or restore a checkpoint; rollback requires the backend's exact-entry fork capability |
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

or use the SQLite-configured systemd unit below.

## Container builds: local SQLite source and published fallback

The SQLite image requires an explicit BuildKit context, so it cannot silently
install a registry package when the local checkout is missing:

```sh
docker build -f Dockerfile.local-pi \
  --build-context pi-source=/home/ubuntu/pi-coding-agent \
  --build-arg PI_LOCAL_REV="$(git -C /home/ubuntu/pi-coding-agent rev-parse HEAD)" \
  --build-arg PI_LOCAL_VERSION=0.80.6 \
  -t pi-lot-ui:sqlite .
```

That image labels the pi source, revision, and version, runs Node 22, selects
SQLite, and runs the process-level SQLite tests against the packed CLI at
`/opt/pi/node_modules/.bin/pi`. `PI_SQLITE_TEST_BIN` is only the explicit test
artifact override; production processes use `PI_BIN`.

Release builds that intentionally use the published JSONL fallback remain
available through the default Dockerfile. The package and matching label are
explicit build arguments rather than an implicit global install:

```sh
docker build \
  --build-arg PI_PACKAGE_SPEC=@earendil-works/pi-coding-agent@0.80.3 \
  --build-arg PI_PACKAGE_VERSION=0.80.3 \
  -t pi-lot-ui:published .
```

## SQLite backup and rollback

SQLite runs in WAL mode. For an online backup while pi processes are active,
use Node's SQLite backup API (the destination is a consistent standalone copy):

```sh
mkdir -p "$HOME/pi-backups"
node --input-type=module -e 'import { DatabaseSync, backup } from "node:sqlite"; const source = new DatabaseSync(`${process.env.HOME}/.pi/agent/sessions.sqlite`, { readOnly: true }); const day = new Date().toISOString().slice(0, 10); await backup(source, `${process.env.HOME}/pi-backups/sessions-${day}.sqlite`); source.close()'
```

For a filesystem-level backup, stop every pi writer first and copy the main
file together with any WAL/SHM sidecars; copying only `sessions.sqlite` while
the service is active is not a valid backup:

```sh
systemctl --user stop pi-ui.service
mkdir -p "$HOME/pi-backups/stopped"
for file in "$HOME/.pi/agent/sessions.sqlite"{,-wal,-shm}; do
  test ! -e "$file" || cp --preserve "$file" "$HOME/pi-backups/stopped/"
done
systemctl --user start pi-ui.service
```

Switching backends does not migrate or delete either store. To roll back to
JSONL under systemd, add an override and restart:

```sh
mkdir -p ~/.config/systemd/user/pi-ui.service.d
printf '[Service]\nEnvironment=PERSISTENT_STORE=jsonl\n' > ~/.config/systemd/user/pi-ui.service.d/rollback.conf
systemctl --user daemon-reload
systemctl --user restart pi-ui.service
```

Remove `rollback.conf`, reload, and restart to select SQLite again.

## Tunnel notes

Anything that forwards plain HTTP to port 8080 works, e.g.:

```sh
cloudflared tunnel --url http://localhost:8080
ssh -R 80:localhost:8080 nokey@localhost.run
```

The token is your only line of defense once tunneled — treat the URL-with-token like a password.

## Running the local SQLite pi as a service

The unit pins the built local CLI, `PERSISTENT_STORE=sqlite`, and
`~/.pi/agent/sessions.sqlite`. Build pi, render the UI directory placeholder,
then enable the user service:

```sh
npm -C /home/ubuntu/pi-coding-agent run build
mkdir -p ~/.config/systemd/user
sed "s|__PI_UI_DIR__|$(pwd)|g" pi-ui.service > ~/.config/systemd/user/pi-ui.service
systemctl --user daemon-reload
systemctl --user enable --now pi-ui.service
sudo loginctl enable-linger ubuntu   # keep it running with no active login session
```

Verify that the running service—not merely its environment file—reports the
intended executable, backend, and database:

```sh
curl -fsS http://127.0.0.1:8080/health | node -e 'let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{const h=JSON.parse(s); console.log(h.pi); if(h.pi.persistentStore!=="sqlite" || !h.pi.bin.includes("/home/ubuntu/pi-coding-agent/")) process.exit(1)})'
```

After changing or rebuilding pi, use `systemctl --user restart pi-ui.service`
and run the health check again. The token comes from `.ui-token` next to
`server.mjs`. Logs: `journalctl --user -u pi-ui -f`.
