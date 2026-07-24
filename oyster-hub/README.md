# Oyster Hub prototype

Oyster Hub serves the standard Oyster interface and acts as an API gateway for Oyster workspaces. Workspace membership is supplied by a configurable **workspace driver**, rather than a static list. Every driver lists workspaces and advertises capabilities; creation and removal are optional.

Two prototype drivers are included:

- `llmbox` treats each llmbox box as a workspace and can query and create boxes.
- `mock` returns one or more configured existing Oyster workspaces and cannot create or remove anything.

## Architecture

```text
browser / automation
        |
        v
 Oyster Hub API  /api/v1/workspaces/{wid}/...
        |
        +-- llmbox JS facade -- N-API async work
        |                       |
        |                    C ABI
        |                       |
        |                 embedded Go hub -- WebSocket --> spokes
        |
        +-- scoped proxy ----------------------> Oyster inside the box
```

Oyster Hub remains bearer-token authenticated. Oyster processes inside llmbox workspaces can run with `--unauthenticated` because llmbox is the authenticated outer boundary. For deployments that retain per-spoke Oyster authentication, the driver also derives a stable unique bearer token with HMAC-SHA256 and injects it at `driver.tokenFile.path`; those tokens can be derived again after restart and are never returned by the API.

## Local mock driver

Run the read-only mock hub on port **8082** while the host Oyster spoke listens on `http://localhost:8080`:

```sh
# Start the local spoke separately (llmbox is the outer auth boundary).
node server/server.mjs --port 8080 --unauthenticated

# Starts Oyster Hub at http://127.0.0.1:8082.
npm run hub:mock
```

The checked-in `config.mock.example.json` selects the mock driver and maps the Oyster services on ports 8080 and 8083 to the `local` and `pi-2` workspaces. Its `sharedTokenFile` loads one bearer token for the Hub and every mock-driver workspace without copying the secret into configuration. `OYSTER_HUB_SHARED_TOKEN_FILE` can override the path; explicit `OYSTER_HUB_TOKEN` and `OYSTER_HUB_DRIVER_TOKEN` values take precedence. A legacy single-workspace `endpoint`/`id`/`name` object remains supported. Both `POST /api/v1/workspaces` and workspace deletion return `405`.

```json
{
  "port": 8082,
  "sharedTokenFile": "/home/ubuntu/tree-pi/.ui-token",
  "driver": {
    "type": "mock",
    "workspaces": [
      { "endpoint": "http://localhost:8080", "environmentId": "local", "environmentName": "Local", "id": "local", "name": "Local Oyster" },
      { "endpoint": "http://localhost:8083", "environmentId": "local", "environmentName": "Local", "id": "pi-2", "name": "Pi 2" }
    ]
  }
}
```

The Hub itself still requires the shared bearer token.

## Configure llmbox

The llmbox spoke image/init script must install Oyster and start it on `workspacePort`. A simplified init-script fragment is:

```sh
#!/bin/sh
set -eu
cd /workspace/oyster
exec node server/server.mjs --host 0.0.0.0 --port 8080 --unauthenticated
```

Build the native binding once per target platform:

```sh
npm run build:llmbox-bindings
```

The build produces `llmbox.node` and its colocated `libllmbox.so` under `llmbox/bindings/build/`. It requires a CGo toolchain, a C++17 compiler, and Node's `node_api.h`. The addon uses N-API, while the Go shared library remains platform- and architecture-specific.

The embedded Go hub still binds the `http_addr` from `llmbox.yaml`: spokes need `/spoke/connect`, and box proxy subdomains need a listener. Oyster Hub does **not** call the box-control HTTP API; list/create/proxy operations cross the async N-API → C ABI boundary in-process. The llmbox SQLite store, Go runtime, and spoke registry are opened once by `oyster-hub/server.mjs` and survive every request.

The Hub calls workspace proxy URLs as a headless service, so llmbox's OIDC gate for proxy subdomains must be disabled or bypassed on a trusted internal route. Service authentication for OIDC-gated proxy URLs is future work. `createProxy: true` creates the Oyster proxy after box creation. A spoke may also publish the Oyster port itself with `--publish-port`.

## Run

```sh
cp llmbox/llmbox.example.yaml llmbox.yaml
cp oyster-hub/config.example.json oyster-hub/config.json
# Set public_url/proxy settings, the Hub token, and a stable random tokenSecret.
npm run build:llmbox-bindings
npm run hub
```

Open `http://127.0.0.1:8787/#token=<hub-token>`. The standard Oyster interface stores the token using its normal authentication flow. `oyster-hub/config.json` is git-ignored.

### Cloud VM source bootstrap

The cloud connector supports DigitalOcean, AWS EC2, and GCP Compute Engine. Creating an environment generates a one-use, generation-scoped registration secret and submits provider-native user data:

- DigitalOcean: `user_data` on the Droplet create request;
- AWS: base64 `UserData` on `RunInstances`; and
- GCP: the `user-data` instance metadata item.

The generated `#cloud-config` installs Node.js 22, Git, and build dependencies, clones [`SergeiKireevDev/oyster`](https://github.com/SergeiKireevDev/oyster/tree/main) at `main`, initializes submodules, runs both lockfile-scoped installs, builds pi and the Oyster UI, and installs two services. `oyster.service` listens only on `127.0.0.1:8080`; `oyster-box-agent.service` makes an outbound connection to `wss://hub.get-oyster.dev/box/connect`.

```json
{
  "cloud": {
    "stateFile": "./cloud-state.json",
    "registryStateFile": "./box-registry.json",
    "boxConnectUrl": "wss://hub.get-oyster.dev/box/connect",
    "repository": "https://github.com/SergeiKireevDev/oyster.git",
    "ref": "main"
  }
}
```

Provider credentials remain in the owner-only cloud state file and are never sent to the VM. The VM receives only its box ID, generation, provider kind, and expiring one-use bootstrap secret. After the first WebSocket registration, Hub returns a generation-scoped reconnect credential which the agent stores under `/var/lib/oyster-box-agent/`. Provider resources are created with Hub ownership, box ID, and generation tags/labels.

`/box/connect` accepts no query credentials and keeps the box principal separate from `/spoke/connect`. It implements registration, status, heartbeat, reconnect, connection replacement, and bounded multiplexed Dial streams to Oyster on box-local `127.0.0.1:8080`. Hub carries workspace HTTP, uploads, and SSE over those streams without exposing the VM service publicly. Exec remains a follow-up protocol capability. The registry binds registration to the instance ID returned by the provider connector and requires a provider attestation envelope; production deployments should inject cryptographic attestation verification in addition to the built-in envelope and identity checks.

The UI-facing `/sessions` and `/runners` APIs aggregate every discovered workspace. Hub-scoped opaque session and runner identities prevent collisions, while each item includes `environmentId`, `environmentName`, `workspaceId`, and `workspaceName`. An environment is the physical or cloud device (`spoke` for llmbox); a workspace is the project microVM on that device; a session is one discussion thread. The session sidebar presents that hierarchy and uses cwd as a category within each workspace, not as workspace identity. Session operations, RPC, and SSE are routed back to the owning workspace; no iframe embedding is used.

Every non-aggregate workspace request must be explicit through a scoped identity, `X-Oyster-Workspace`, or the `workspace` query parameter. The Hub never falls back to the first workspace. On browser startup the UI lists workspaces, persists an explicit online selection, and only then opens its event stream. If none are available, startup stops with guidance to create an environment or workspace first. Starting a session in Hub mode always asks for an online workspace before opening that workspace's folder browser; canceling the picker leaves the current workspace and session unchanged.

### Driver configuration

```json
{
  "driver": {
    "type": "llmbox",
    "transport": "native",
    "binding": {
      "addonPath": "llmbox/bindings/build/llmbox.node",
      "configPath": "llmbox.yaml",
      "closeTimeoutMs": 5000
    },
    "tokenSecret": "stable-random-secret",
    "workspacePort": 8080,
    "createProxy": true,
    "tokenFile": {
      "path": "/run/secrets/oyster-ui-token",
      "mode": 384,
      "uid": 0,
      "gid": 0
    }
  }
}
```

The injected token is ignored by an Oyster process started with `--unauthenticated`; it remains available so the same driver can provision token-authenticated spokes. For a Firecracker spoke whose authenticated Oyster process runs as `agent`, set the injected file's `uid`/`gid` to that user's numeric IDs. Changing `tokenSecret` invalidates access to authenticated existing workspaces, so keep it stable and secret.

Environment overrides are available for deployment:

| Variable | Configuration |
|---|---|
| `OYSTER_HUB_TOKEN` | Hub API bearer token |
| `OYSTER_HUB_LLMBOX_ADDON` | native `llmbox.node` path |
| `OYSTER_HUB_LLMBOX_CONFIG` | embedded llmbox YAML config path |
| `OYSTER_HUB_WORKSPACE_TOKEN_SECRET` | HMAC secret used to derive Oyster tokens |
| `OYSTER_HUB_CLOUD_STATE_FILE` | Owner-only cloud credentials and provision records |
| `OYSTER_HUB_BOX_REGISTRY_STATE_FILE` | Hashed bootstrap/reconnect records and observed box state |
| `OYSTER_HUB_BOX_CONNECT_URL` | Public `wss://` callback used by generated cloud-init |
| `OYSTER_HUB_SOURCE_REPOSITORY` | HTTPS Oyster source repository cloned by cloud-init |
| `OYSTER_HUB_SOURCE_REF` | Source branch/tag cloned by cloud-init |
| `HOST`, `PORT` | Listener |

## API

Hub requests accept `Authorization: Bearer ...`, `X-API-Key`, or `X-Auth-Token`.

| Route | Purpose |
|---|---|
| `GET /health` | Unauthenticated hub and configured-driver identity. |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 schema. |
| `GET /api/v1/environments` | List driver-discovered and cloud environments. |
| `POST /api/v1/environments` | Provision a cloud VM with source-installing cloud-init and pending box registration. |
| `GET /api/v1/cloud/providers` | List supported providers and redacted credential status. |
| `PUT, DELETE /api/v1/cloud/providers/{provider}/credentials` | Store or remove write-only provider credentials. |
| `GET /api/v1/cloud/providers/{provider}/options` | Query live regions/zones, instance types, and images. |
| `WSS /box/connect` | Restricted, generation-scoped outbound box-agent registration. |
| `GET /api/v1/workspaces` | Query llmbox and list discovered workspaces. |
| `POST /api/v1/workspaces` | Create a workspace when the selected driver advertises that capability; otherwise `405`. |
| `GET /api/v1/workspaces/{wid}` | Inspect one dynamically discovered workspace. |
| `GET /api/v1/overview` | Aggregate health, runners, sessions, routines, and hublots. |
| `ANY /api/v1/workspaces/{wid}/{path...}` | Proxy an existing Oyster endpoint to one workspace. |

Create a workspace:

```sh
curl -H "Authorization: Bearer $HUB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"refactor-auth","name":"Auth refactor","spoke":"edge-1","diskBytes":21474836480}' \
  http://127.0.0.1:8787/api/v1/workspaces
```

Then query its Oyster server through the stable scoped API:

```sh
curl -H "Authorization: Bearer $HUB_TOKEN" \
  http://127.0.0.1:8787/api/v1/workspaces/refactor-auth/runners
```

The hub replaces its credential with the workspace-specific derived credential before forwarding. Redirects are not followed, `Set-Cookie` is not relayed, and llmbox/Oyster credentials are never included in responses.

### Streaming uploads

The standard Oyster file explorer keeps its existing resumable protocol: it sends ordered 8 MiB raw chunks to `POST /file-upload` with `offset` and `last` query parameters. Oyster Hub resolves and authorizes the workspace before forwarding any bytes, then streams each opaque request body with backpressure instead of buffering the chunk. JSON requests remain bounded and buffered because scoped session and runner identities inside JSON must be decoded before routing.

The llmbox proxy carries the resulting HTTP request over the same raw `DialBox` stream used by downloads, SSE, and WebSockets. No upload-specific cluster verb is required. A future reverse-connected cloud box agent must implement the same box-scoped `DialBox(ctx, boxID, localhostPort)` stream contract, so the browser and Oyster upload endpoint remain unchanged.

Three timeout settings have distinct roles:

| Setting | Default | Meaning |
|---|---:|---|
| `timeoutMs` | 5000 | Bounded workspace discovery, JSON, and bodyless request/response operations. |
| `uploadIdleTimeoutMs` | 30000 | Maximum interval with no upload bytes making progress; reset for every forwarded chunk. |
| `uploadResponseTimeoutMs` | 30000 | Maximum wait for workspace response headers after the final upload byte. |
| `maxConcurrentUploads` | 16 | Hub-wide cap on opaque streaming request bodies; excess requests receive `429`. |

Both upload settings accept 100 ms through 30 minutes. Increase the idle setting for highly latent or intermittently scheduled cloud VMs. A progressing upload may run longer than `timeoutMs`; an idle stream is aborted and the browser retries from the workspace-reported offset. Transfer diagnostics expose only workspace ID, byte counts, duration, and close reason—never body contents or credentials.

## Prototype boundaries

- The native `llmbox` and read-only local `mock` drivers are implemented; `drivers/index.mjs` is the extension point. The older llmbox HTTP transport remains available by omitting `transport: "native"` for compatibility.
- Discovery and aggregation are request-time queries; cloud credentials/provision records and hashed box registrations use their configured owner-only state files.
- `/box/connect` carries registration, status, heartbeat, reconnect, and multiplexed localhost Dial. Restricted Exec is not yet advertised.
- A newly created box is `provisioning` until llmbox exposes its configured Oyster port.
- An active workspace SSE stream includes runner snapshots from the other discovered workspaces; non-runner events remain scoped to the active workspace.
- Authentication is one shared hub bearer token; user accounts and per-workspace authorization are future work.
