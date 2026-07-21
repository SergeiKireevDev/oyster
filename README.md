# Oyster

A small web UI for driving the [pi coding agent](https://github.com/badlogic/pi-mono) remotely — from a phone or any browser — through a tunnel.

Full installation, operation, user, architecture, and API guides are available in the [GitDocs documentation](docs/readme.md).

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), the
[security policy](SECURITY.md), and the [Code of Conduct](CODE_OF_CONDUCT.md).
Oyster is available under the [MIT License](LICENSE).

```
browser ──HTTP/SSE──> server/server.mjs ──stdin/stdout RPC──> pi --mode rpc (one per open session)
                              │
                              └── session catalog ──> SQLite or JSONL
```

### Runtime and session architecture

The stable core (`server/server.mjs`) validates the configured pi executable and
persistence store once, then owns everything that must survive a hot reload:
the socket, SSE clients, catalog lifecycle, centralized pi process launcher,
and child processes. `server/app.mjs` is the replaceable router and composes the HTTP
routes with the runner, session, tunnel, routine, credential, and file modules.

`server/sessions.mjs` selects a backend-neutral catalog. SQLite discovery and
transcript reads use request-scoped, read-only `node:sqlite` handles in
`server/sessions/sqliteCatalog.mjs`; JSONL parsing and its mtime/LRU cache live only in
`server/sessions/jsonlCatalog.mjs`. Workflow mutations are never issued as SQL by this
server: SQLite delete and exact-entry fork delegate to repository operations
shipped with the configured pi CLI.

A persisted session is represented internally by `{ backend, id, storagePath }`
and serialized as an opaque `ps1_…` session key. For SQLite, `storagePath` is
the shared database and `id` distinguishes sessions; the database path alone
is never an identity. `sessionFile` and path query parameters exist only as
JSONL compatibility fields for older links and clients.

### Hot reload scope

The stable core watches `server/app.mjs` and the HTTP route modules under `server/http/`.
During development or runtime recovery, changes are loaded with mtime query
parameters and the complete route table is constructed before the active
handler is swapped. A failed import or construction leaves the previous
handler and existing SSE connections running. Each successful reload creates
new ESM cache entries, so this mechanism is not intended as a production
rollout strategy: production deployments should replace the Node process to
bound module-cache growth and guarantee a clean application version.

- **Minimal runtime** — Node ≥ 22.19 is universally required because the stable server uses `node:sqlite` for Oyster application data, including when pi sessions use JSONL. No npm SQLite driver is used. Tests: `npm test`.
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
`PI_UI_TOKEN` or the project-root `.ui-token` file.

## Quick start

Build the SQLite-enabled development checkout once, then start the UI:

```sh
cd /home/ubuntu/pi-coding-agent && npm run build
cd /home/ubuntu/tree-pi-bak-sql && node server/server.mjs
```

Development defaults to
`/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js` with
`PERSISTENT_STORE=sqlite`. The server refuses to start if that executable is
missing/stale, when Node is older than 22.19, or if the store value is invalid. SQLite sessions are stored in
`~/.pi/agent/sessions.sqlite` by default (or `sessions.sqlite` under
`PI_CODING_AGENT_DIR`/`--session-dir`).

To use the JSONL rollback mode without migrating or modifying either store:

```sh
PERSISTENT_STORE=jsonl PI_BIN=/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js node server/server.mjs
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
| – | `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi agent directory; owns `auth.json`, `models.json`, and the default `sessions.sqlite` |
| – | `PI_UI_DB_PATH` | `~/.pi/agent/pi-lot-ui.sqlite` | separate SQLite database for Oyster-owned application data |
| `--pi-args "…"` | `PI_ARGS` | – | extra args appended to `pi --mode rpc`; `--session-dir <dir>` relocates `sessions.sqlite` |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | binary used to open tunnels (must support `tunnel --url http://127.0.0.1:<port>`) |

A project-root `.ui-token` file (one line, the token) keeps the token stable across restarts. It is git-ignored.

### Mutable-setting precedence

`PI_DIR`/`--dir` is the validated startup default. After `POST /workdir` changes the current directory, that absolute path is stored in `app_settings.current_workdir` and takes precedence on later starts. The selected default runner ID is likewise stored in `app_settings.default_runner_id`. Missing, malformed, or type-invalid persisted values are ignored in favor of the startup workdir or no default runner; valid persisted mutable values never override unrelated startup configuration.

Non-secret browser preferences are a separate policy domain and **do not sync to SQLite** in this migration. Thinking visibility (`pi_show_thinking`), carousel position (`pi_carousel`), and browser runner selection (`pi_runner`) remain device-local in `localStorage`. They do not affect server ownership or recovery, and keeping them local avoids surprising cross-device UI changes. Authentication material is not a preference and is governed separately. The server token comes only from `PI_UI_TOKEN`, `--token`, the dedicated `.ui-token` file, or a process-memory random fallback; the browser auth client uses its dedicated `pi_ui_token` key. Token, secret, password, credential, and API-key fields are rejected by the general `app_settings` repository and never participate in preference synchronization.

### Pi credential ownership, OAuth, and precedence

The authenticated **Credentials…** menu manages local pi credentials through
the `AuthStorage` exported by the installation that owns the configured
`PI_BIN`. Credentials remain in `PI_CODING_AGENT_DIR/auth.json` (normally
`~/.pi/agent/auth.json`, mode `0600`); Oyster never copies them into its
SQLite database, browser storage, responses, logs, or event stream. Custom
API-key provider choices come from that same installation's `models.json` and
model registry. OAuth sign-in is offered only for providers returned by that
configured SDK's `AuthStorage.getOAuthProviders()`—normally ChatGPT Plus/Pro
(Codex), Claude Pro/Max, and GitHub Copilot. The UI server does not execute
project extensions merely to discover additional OAuth implementations. Stored
OAuth credentials whose implementation is unavailable remain visible and can
be removed. If the configured executable does not expose the required SDK,
credential management fails closed instead of loading another global pi.

OAuth protocol details stay owned by Pi: provider discovery, PKCE/state checks,
token exchange, refresh, and locked persistence all use Pi's SDK. Oyster
adapts Pi's browser-authorization, device-code, selection, prompt, progress, and
manual-code callbacks into an authenticated, transient modal. Authorization
URLs, device codes, redirect URLs, and prompt answers remain in memory only for
the bounded active flow; they never enter URLs controlled by Oyster, SQLite,
local/session storage, logs, SSE, or runner state. Flows expire after 15 minutes
of inactivity and can be cancelled. If the browser runs on another machine and
a provider redirects to a loopback callback on that browser, copy the final
redirect URL or authorization code from the unreachable page and paste it into
the modal. Device-code providers instead show a verification link and user code.
The main Oyster window never navigates to a provider automatically. When the
app starts with no entries in `auth.json`, it opens **Credentials…** setup once;
opening an upstream authorization page still requires a user click.

A stored `auth.json` credential takes precedence over process-environment and
`models.json` authentication. Saving/replacing an API key or completing OAuth
sign-in/sign-out restarts every pi runner that was active when the credential
mutation completed; inactive runners remain stopped. Cancellation and failed
sign-in do not restart runners. A partial restart is reported without rolling
back the already durable credential. After removal, environment or `models.json` fallback credentials may still authenticate the provider. **Remove from pi** and **Sign out from pi** only delete local stored credentials. Removing a key from pi does not revoke the key at the upstream provider, and signing out does not revoke its OAuth grant. Revoke compromised keys
or connected-app access with the provider itself.

`npm test` includes a process-level contract against the exact local pi path:
it creates a SQLite conversation with an offline mock model, stops pi, and
restores the same session with `--continue`. Environments intentionally testing
the published JSONL fallback (the current release-image build path) must opt out
explicitly with `PI_SQLITE_CONTRACT_TEST=skip`; the test never substitutes a
global `pi` binary silently.

For legacy application-data cutovers, use the [application-data migration runbook](docs/app-data-migration.md).

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | no | the UI (static, secret-free) |
| `GET /health` | no | liveness plus active pi executable/backend/database diagnostics (never tokens or credentials) |
| `GET /events` | yes | SSE stream of pi's stdout (events + responses), with replay of recent lines |
| `POST /rpc` | yes | JSON body forwarded verbatim to pi's stdin |
| `GET /api-keys` | yes | list provider IDs, display names, credential types, and safe source/status metadata; never returns key material |
| `POST /api-keys` | yes | store or replace through pi `AuthStorage` using `{ "provider": "…", "key": "…", "restart": true }`; restarts runners active at capture time |
| `DELETE /api-keys` | yes | remove a stored API key using `{ "provider": "…", "restart": true }`; does not revoke it upstream and fallback auth may remain |
| `POST /oauth/start` | yes | start a transient Pi-owned OAuth login with `{ "provider": "…", "replace": false }`; `replace: true` is required to replace a stored API key/OAuth credential |
| `POST /oauth/status` | yes | poll with `{ "flowId": "…" }`; returns only the current transient interaction and safe terminal/restart state |
| `POST /oauth/respond` | yes | answer one pending prompt/selection/manual-code request once with `{ "flowId": "…", "requestId": "…", "value": "…" }` |
| `POST /oauth/cancel` | yes | cancel a pending flow with `{ "flowId": "…" }`, aborting Pi's callback server or device polling |
| `DELETE /oauth` | yes | sign out locally with `{ "provider": "…", "restart": true }`; does not revoke upstream access and reports fallback auth |
| `POST /restart` | yes | kill and respawn one selected runner (`?runner=…`) |
| `GET /runners` / `DELETE /runners?id=…` | yes | list runners or stop one runner |
| `POST /open-session` | yes | create/resume a runner using `{ "sessionKey": "ps1_…", "dir": "…" }`; legacy `sessionPath` remains JSONL-only compatibility input |
| `GET /sessions` | yes | list catalog summaries with canonical `sessionKey` and `sessionRef`; optional `dir` scopes the catalog |
| `GET /session-by-id` | yes | resolve a saved session by `key=ps1_…` (legacy `id`/path lookup is accepted for JSONL) |
| `GET /session-entries` / `GET /session-messages` | yes | read durable active-branch entries/messages selected by `key=ps1_…` |
| `GET /session-folders` / `GET /search` | yes | discover workdirs and search durable sessions; search results carry opaque session keys |
| `DELETE /session?key=ps1_…` | yes | delete through the selected backend capability; SQLite never unlinks the shared database |
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
- Send prompts (Enter), steer mid-stream (send while streaming), **Stop** to abort. Tap the microphone to dictate into the composer; dictation stays as an editable draft and is never sent automatically. Chrome/Edge use the Web Speech API. Brave and browsers without that API record locally and transcribe on-device with quantized Whisper Base English; its roughly 75 MB of model weights are downloaded and browser-cached on first use, so the initial transcription is slower but remains practical on modern mobile devices.
- Model picker, thinking-level cycling, new session, context compaction, pi process restart — from the header chips / ☰ menu.
- **Credentials…** — the ☰ menu opens Pi credential setup and status. It shows safe provider/source labels only; adds, replaces, or removes API keys; and signs in, re-authenticates, cancels, or signs out for OAuth-capable providers through browser, device-code, selection, prompt, and manual redirect flows. Inputs are never prefilled or redisplayed. Credential mutations use explicit all-active-runner restart confirmations, and local removal/sign-out is clearly distinguished from upstream revocation. An empty `auth.json` opens this setup workflow automatically once per page mount without navigating upstream.
- **Tunnels** — ☰ → *Tunnels…* opens a modal listing live tunnels and lets you spawn a new one deterministically for the current session: pick a local port, describe *what the agent should expose through it*, and (by default) the UI briefs the agent with the public URL and that description so it starts the right server on that port. Tunnels are cloudflared quick tunnels by default (`--tunnel-bin` to change), survive server code hot-reloads, and are killed on shutdown. Requires [`cloudflared`](https://pkg.cloudflare.com) (or an equivalent tool) to be installed.
- **Routines** — a second sidebar section lists runnable scripts from the global store `~/.pi/routines/` (any executable file). Starting one **binds it to the current session**: it runs in that session's workdir, other sessions can't start it until it is **released**, and the binding (plus workdir) is persisted in `~/.pi/routines/bindings.json` so teardown finds the byproducts even across server restarts. Each routine can be **started** (`<script> run`), **stopped** (SIGTERM/SIGKILL to its process group) and **torn down** (`<script> teardown`, expected to remove the run's byproducts); deleting a session stops and releases its routines. Routines natively report progression: any stdout line of the form `::progress <0-100> <message>` drives a live progress bar and status message in the sidebar; other output is kept as a log tail (hover the message). Terminal states (finished / failed / stopped / torn down) surface as toasts.
- Extension UI bridge: pi extensions that ask for confirm/select/input get a modal in the browser; notifications become toasts.
- Reconnects automatically (EventSource); recent events are replayed on reconnect so a page refresh mid-run doesn't lose context.
- Mobile-friendly layout.

## Running it in the background

```sh
PI_UI_TOKEN=$(cat .ui-token) nohup node server/server.mjs > /tmp/pi-ui.log 2>&1 &
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
  -t oyster:sqlite .
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
  -t oyster:published .
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

The token is your only line of defense once tunneled — treat the URL-with-token like a password. Every `/api-keys` and `/oauth*` request requires normal Oyster authentication. Provider keys, OAuth flow IDs, authorization codes, redirect URLs, and prompt responses are accepted only in bounded JSON bodies, never in URL paths or query strings. Existing keys and OAuth tokens—including masks, prefixes, suffixes, fingerprints, and lengths—are never returned. Authorization URLs and device/manual interaction data are returned transiently only to the authenticated browser participating in that flow.

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
`server/server.mjs`. Logs: `journalctl --user -u pi-ui -f`.
