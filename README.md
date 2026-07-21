<h1 align="center"><img src="public/src/assets/oyster.svg" width="48" alt="Oyster logo" align="absmiddle"> Oyster</h1>

<p align="center">
  A mobile-friendly web workspace for running the <a href="https://github.com/badlogic/pi-mono">pi coding agent</a> from anywhere.
</p>

<p align="center">
  <a href="https://github.com/SergeiKireev/oyster/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/SergeiKireev/oyster/actions/workflows/ci.yml/badge.svg?branch=master"></a>
  <img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-5FA04E?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-9DA9FF"></a>
</p>

Oyster puts pi's sessions, streaming output, tools, files, credentials, routines, and local web apps into one responsive browser UI. It uses ordinary HTTP and Server-Sent Events, making it easy to run locally, behind a reverse proxy, or through a secure tunnel.

## Screenshots

<table>
  <tr>
    <td width="72%"><strong>Desktop workspace</strong><br><img src="docs/images/oyster-desktop.png" alt="Oyster desktop workspace with session and resource sidebars"></td>
    <td width="28%"><strong>Mobile workspace</strong><br><img src="docs/images/oyster-mobile.png" alt="Oyster mobile conversation view"></td>
  </tr>
</table>

## Highlights

- **Live agent sessions** — stream Markdown, math, thinking, tool calls, and partial output as pi works.
- **Desktop and mobile** — manage the same workspace comfortably from a laptop, tablet, or phone.
- **Session management** — search, resume, fork, archive, and switch between SQLite- or JSONL-backed conversations.
- **Workspace tools** — browse, edit, and download files without leaving the app.
- **Routines and hublots** — run repeatable jobs with live progress and expose local web interfaces through managed tunnels.
- **Pi-native credentials** — manage API keys and supported OAuth providers while credentials remain in pi's own storage.
- **Resilient connections** — SSE replay and automatic reconnect preserve context across refreshes and network changes.

## How it works

```text
browser ── HTTP + SSE ──> Oyster server ── RPC over stdio ──> pi --mode rpc
                              │
                              ├── Oyster application data
                              └── pi session catalog (SQLite or JSONL)
```

The stable Node.js server owns HTTP connections, child processes, and persistent application state. Each active runner gets its own pi RPC process. The Svelte frontend is compiled into `dist/` and served by the same process.

## Quick start

### Requirements

- **Node.js ≥ 22.19**
- A built and executable [pi](https://github.com/badlogic/pi-mono) CLI
- `cloudflared` only if you want public hublots

```bash
git clone https://github.com/SergeiKireev/oyster.git
cd oyster
npm ci
npm run build
HOST=127.0.0.1 PI_BIN="$(command -v pi)" node server/server.mjs
```

The server prints an authentication token on first start and saves it to the git-ignored `.ui-token` file. Open:

```text
http://127.0.0.1:8080/#token=<TOKEN>
```

The browser stores the token locally and removes it from the address bar. Check the runtime without exposing secrets:

```bash
curl --fail http://127.0.0.1:8080/health
```

See the [installation guide](docs/getting-started/installation.md) for source, service, and container workflows.

> [!WARNING]
> **Remote access requires HTTPS with valid TLS.** The bearer token authenticates requests but does not encrypt prompts, transcripts, files, or OAuth traffic. Treat Oyster access like shell access and never publish port 8080 directly to an untrusted network. Read the [security guide](docs/getting-started/security.md) before exposing it remotely.

## Configuration

Flags override their matching environment variables.

| Flag | Environment | Default | Purpose |
|---|---|---|---|
| `--port` | `PORT` | `8080` | HTTP port |
| `--host` | `HOST` | `0.0.0.0` | Bind address |
| `--token` | `PI_UI_TOKEN` | `.ui-token`, then random | Browser/API bearer token |
| `--dir` | `PI_DIR` | current directory | Initial agent workspace |
| `--pi` | `PI_BIN` | local development CLI | pi executable |
| `--pi-args` | `PI_ARGS` | empty | Extra pi RPC arguments |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | Tunnel executable |
| — | `PERSISTENT_STORE` | `sqlite` | pi session catalog (`sqlite` or `jsonl`) |
| — | `PI_UI_DB_PATH` | `~/.pi/agent/oyster.sqlite` | Oyster-owned application database |

Validate startup configuration without serving HTTP:

```bash
PI_BIN=/absolute/path/to/pi node server/server.mjs --check-config
```

The [configuration reference](docs/getting-started/configuration.md) covers persistence, authentication, setting precedence, and database separation.

## Bundled pi extensions

Register the included extensions with the pi installation that launches your sessions:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)"/extensions/*.ts ~/.pi/agent/extensions/
```

| Extension | Capability |
|---|---|
| `file-explorer.ts` | `/files` and `ctrl+o` workspace browser |
| `hublot.ts` | Managed public interfaces for local ports |
| `routine.ts` | Repeatable scripts with progress and teardown |
| `goal-loop.ts` | Plan execution in verified, committed steps |

Restart pi after adding or changing extensions. Learn more in the [extensions guide](docs/user-guide/extensions.md).

## Credentials and OAuth

Credentials are managed through the `AuthStorage` exported by the configured pi installation. They remain in `PI_CODING_AGENT_DIR/auth.json` with mode `0600`; Oyster never returns existing secret material to the browser. A stored `auth.json` credential takes precedence over an environment or `models.json` fallback.

| Route | Purpose |
|---|---|
| `GET /api-keys` | List safe provider and credential-source metadata |
| `POST /api-keys` | Store or replace an API key |
| `DELETE /api-keys` | Remove pi's local key; this does not revoke the key at the upstream provider |
| `POST /oauth/start` | Start a transient OAuth flow |
| `POST /oauth/status` | Poll its interaction or terminal state |
| `POST /oauth/respond` | Answer a pending prompt or manual-code request |
| `POST /oauth/cancel` | Cancel provider callbacks or polling |
| `DELETE /oauth` | Remove pi's local OAuth credential; this does not revoke its OAuth grant |

A successful mutation restarts every pi runner that was active when it completed; inactive runners remain stopped. OAuth providers come only from `AuthStorage.getOAuthProviders()`, while pi owns PKCE/state checks, token exchange, refresh, and locked persistence. Flows expire after 15 minutes of inactivity. If a provider redirects another device to a loopback callback, copy the final URL or code from the unreachable page and paste it into the modal. When there are no entries in `auth.json`, Oyster offers credential setup once without navigating to a provider automatically.

See the [credentials guide](docs/user-guide/credentials.md) for replacement, fallback, sign-out, and revocation semantics.

## Deployment and recovery

### Local SQLite service

The included user service pins the local SQLite-enabled pi build. Build pi, render the checkout path into the unit, and enable it:

```bash
npm -C /home/ubuntu/pi-coding-agent run build
mkdir -p ~/.config/systemd/user
sed "s|__PI_UI_DIR__|$(pwd)|g" pi-ui.service > ~/.config/systemd/user/pi-ui.service
systemctl --user daemon-reload
systemctl --user enable --now pi-ui.service
```

After an Oyster or pi update, restart and verify the actual runtime:

```bash
systemctl --user restart pi-ui.service
curl -fsS http://127.0.0.1:8080/health
```

To select the JSONL rollback backend without migrating either store:

```bash
mkdir -p ~/.config/systemd/user/pi-ui.service.d
printf '[Service]\nEnvironment=PERSISTENT_STORE=jsonl\n' > ~/.config/systemd/user/pi-ui.service.d/rollback.conf
systemctl --user daemon-reload
systemctl --user restart pi-ui.service
```

Remove the override and restart to return to SQLite. The [service guide](docs/operations/service.md) covers updates, logs, verification, and lingering.

### Containers

The release image uses a pinned published pi package and JSONL. For SQLite, the local-source image requires an explicit BuildKit context and records the exact pi revision and version:

```bash
docker build -f Dockerfile.local-pi \
  --build-context pi-source=/home/ubuntu/pi-coding-agent \
  --build-arg PI_LOCAL_REV="$(git -C /home/ubuntu/pi-coding-agent rev-parse HEAD)" \
  --build-arg PI_LOCAL_VERSION=0.80.6 \
  -t oyster:sqlite .
```

See [container operations](docs/operations/containers.md) for the published-package build and run commands.

### SQLite backups

SQLite uses WAL mode. While writers are active, use Node's SQLite backup API to create a consistent standalone copy:

```bash
mkdir -p "$HOME/pi-backups"
node --input-type=module -e '
  import { DatabaseSync, backup } from "node:sqlite";
  const source = new DatabaseSync(`${process.env.HOME}/.pi/agent/sessions.sqlite`, { readOnly: true });
  await backup(source, `${process.env.HOME}/pi-backups/sessions.sqlite`);
  source.close();
'
```

For a filesystem copy, stop every writer and preserve the main database with all existing sidecars:

```bash
systemctl --user stop pi-ui.service
for file in "$HOME/.pi/agent/sessions.sqlite"{,-wal,-shm}; do
  test ! -e "$file" || cp --preserve "$file" "$HOME/pi-backups/"
done
systemctl --user start pi-ui.service
```

For clarity, copying only `sessions.sqlite` while the service is active is not a valid backup. Switching backends does not migrate or delete either store. Follow [backup and recovery](docs/operations/backup-and-recovery.md) before restoring data, and use the [application-data migration runbook](docs/app-data-migration.md) for legacy Oyster state.

## Development

```bash
npm ci
npm test
npm run build
npm run docs:build
```

For frontend development, run `npm run dev`; for a production-style local build, serve the generated `dist/` through `node server/server.mjs`. The repository has no separate release build step beyond the Vite build.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security issues must follow the private process in [SECURITY.md](SECURITY.md).

## Documentation

- [Getting started](docs/getting-started/readme.md)
- [User guide](docs/user-guide/readme.md)
- [Operations](docs/operations/readme.md)
- [Architecture](docs/development/architecture.md)
- [HTTP API](docs/reference/http-api.md)

## License

Oyster is available under the [MIT License](LICENSE).
