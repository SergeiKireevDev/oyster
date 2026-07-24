# Streaming File Uploads Through Oyster Hub and llmbox

## What changed

Oyster's existing file explorer can now upload files reliably through Oyster Hub
and a remote llmbox spoke without Oyster Hub buffering each request chunk.

The browser protocol itself did not change. It still:

1. slices each file into 8 MiB chunks;
2. sends each chunk to `POST /file-upload`;
3. identifies the chunk with `offset=<bytes>`;
4. marks the final chunk with `last=1`; and
5. retries safely after connection loss or a lost response.

The feature hardens the gateways and cluster stream carrying that protocol.

## End-to-end data path

```text
Browser file explorer
  │
  │ POST /file-upload?offset=…&last=…
  │ opaque 8 MiB body
  ▼
Oyster Hub
  │  authorize and resolve workspace before forwarding bytes
  │  stream body with backpressure (`duplex: "half"`)
  ▼
llmbox HTTP reverse proxy
  │  DialBox(ctx, boxID, 8080) -> net.Conn
  ▼
llmbox Hub ───── persistent WebSocket ───── llmbox Spoke
  │                multiplexed frames             │
  │                                                │ managed-only DialBox
  │                                                ▼
  └────────────────────────────────────────── Oyster :8080
                                                   │
                                                   ▼
                                    temporary `.name.upload` file
                                                   │ last=1
                                                   ▼
                                         atomic final rename
```

The same `DialBox` interface is the boundary for a future reverse-connected cloud
box agent:

```go
DialBox(ctx context.Context, boxID string, port int) (net.Conn, error)
```

A restricted agent can therefore replace the spoke portion of the path without
changing the browser or Oyster's `/file-upload` endpoint.

## Oyster Hub request handling

Both Hub proxy entry points now share `oyster-hub/workspace-proxy.mjs`:

- standard UI routes such as `/file-upload`; and
- scoped automation routes such as
  `/api/v1/workspaces/{workspace}/file-upload`.

### Authorization happens first

Oyster Hub resolves the target from a scoped identity, `X-Oyster-Workspace`, or
the `workspace` query parameter before forwarding body bytes. It then removes
Hub credentials and installs the workspace credential.

A request cannot begin streaming to one workspace and later select another.

### Opaque bodies stream

Raw and multipart bodies are treated as opaque streams. Oyster Hub does not parse,
copy, or rewrite their bytes. Node's fetch receives the incoming stream directly
with `duplex: "half"`, allowing upstream Oyster to observe data before the browser
has finished sending the request.

Backpressure propagates in the opposite direction:

```text
slow Oyster write
  -> slow spoke stream consumption
  -> exhausted llmbox stream credits
  -> blocked Hub write
  -> blocked Oyster Hub fetch body
  -> browser upload slows
```

### JSON remains bounded and buffered

JSON is intentionally different. Hub-scoped session and runner identities can
appear inside JSON, so those requests must be decoded before workspace routing.
JSON buffering is capped at 5 MiB. Opaque uploads bypass this transformation.

### Header and credential policy

The shared proxy:

- preserves valid `Content-Type` and `Content-Length` headers;
- strips hop-by-hop headers;
- removes browser Hub credentials, cookies, and workspace-selection headers;
- installs the workspace-specific bearer credential;
- does not follow redirects;
- does not relay `Set-Cookie`; and
- preserves response streaming, including SSE.

## Timeout model

A normal workspace timeout is no longer used as the total upload duration.
Instead, progressing uploads use two dedicated bounds:

| Setting | Default | Purpose |
|---|---:|---|
| `timeoutMs` | 5,000 ms | Discovery, JSON, and ordinary bodyless workspace requests. |
| `uploadIdleTimeoutMs` | 30,000 ms | Maximum interval without a forwarded upload byte. Reset on progress. |
| `uploadResponseTimeoutMs` | 30,000 ms | Maximum wait for response headers after the final upload byte. |
| `maxConcurrentUploads` | 16 | Hub-wide opaque streaming request limit. Excess requests receive `429`. |

Example:

```json
{
  "timeoutMs": 5000,
  "uploadIdleTimeoutMs": 30000,
  "uploadResponseTimeoutMs": 30000,
  "maxConcurrentUploads": 16
}
```

Both upload timeouts accept values from 100 ms through 30 minutes. A transfer may
run much longer than `timeoutMs` as long as bytes continue to make progress.

Oyster Hub never replays a consumed stream internally. On failure it returns a
gateway error and lets the browser retry using Oyster's durable offset state.

## Resumability and idempotency

Oyster writes an incomplete file as:

```text
.<filename>.upload
```

Chunk processing is ordered:

- `offset=0` starts a fresh temporary file;
- a later offset must equal the temporary file's current size;
- an out-of-sequence request receives `409` and `{ "have": <size> }`;
- the browser resumes from `have`;
- repeating an already-applied chunk succeeds without duplicating bytes; and
- `last=1` atomically renames the temporary file to its final name.

If a final chunk succeeds but its response is lost, retry detection checks the
completed target's size and returns success.

If a browser disconnects in the middle of a request body, Oyster does not apply
the partial HTTP body. The last fully accepted chunk remains the resume point.

Temporary upload files older than 24 hours are treated as abandoned and removed
when another upload enters that directory. Fresh temporary files and completed
files are not removed.

## llmbox stream flow control

### Why it was needed

The Hub and spoke share one WebSocket for lifecycle RPC and box proxy streams. A
slow box write previously occurred directly on the spoke's shared receive loop.
That could delay unrelated lifecycle responses.

### Negotiated capability

New peers advertise:

```text
stream_flow_control_v1
```

If both sides support it, each stream direction starts with 64 frame credits.
Older peers ignore the capability and retain the legacy stream behavior, allowing
new and old versions to interoperate.

### Frame and window sizes

Each `stream_data` frame carries at most 32 KiB. The initial 64-frame window
therefore permits at most approximately 2 MiB of queued data per direction per
stream.

```text
sender                               receiver
  │                                     │
  ├── stream_data (uses 1 credit) ─────►│ queue/write
  │                                     │
  │◄────────── stream_window ───────────┤ consumed 1 frame
  │             (+1 credit)             │
```

When a stream runs out of credits, only that stream's writer blocks. The shared
WebSocket receive loop remains able to route lifecycle RPC, close frames, and
other streams.

Close, disconnect, and deadline paths release blocked readers and writers and
remove stream registry entries.

## Why stream data is still JSON/base64

A full 32 KiB stream frame currently expands to about the intrinsic 4/3 cost of
base64. A regression test sets a 1.35x wire-expansion decision threshold, and
`BenchmarkStreamFrameJSON` records CPU and allocations.

That measurement did not justify adding a second binary WebSocket envelope in
this change. Binary framing can still be added later, but only behind a separate
capability with old-peer fallback and a measured workload benefit.

## Observability and diagnostics

Oyster Hub's transfer callback reports only:

- workspace ID;
- uploaded and downloaded byte counts;
- elapsed time; and
- close reason.

It does not expose request bodies or credentials.

Run the diagnostic upload benchmark with:

```sh
npm run benchmark:uploads
```

It performs generated 8 MiB and 64 MiB loopback transfers and reports elapsed
time and process RSS. Results are diagnostic and are not timing-sensitive CI
thresholds.

For llmbox framing:

```sh
cd llmbox
go test -bench BenchmarkStreamFrameJSON ./internal/shared/cluster
```

## Failure behavior

| Failure | Result |
|---|---|
| No workspace identity | `400`, before body forwarding. |
| More than one scoped workspace identity | `400`. |
| Unknown workspace | `404`. |
| Concurrent upload limit reached | `429`; browser may retry. |
| No upload progress before idle deadline | `502` with an upload-idle detail. |
| Workspace does not respond after final byte | `502` with a response-timeout detail. |
| Spoke or agent disconnects | Stream closes; browser retries from Oyster's offset. |
| Wrong upload offset | Oyster returns `409` with `have`. |
| JSON body exceeds 5 MiB | `413`. |
| Raw request exceeds Oyster's 100 MiB ceiling | `413`. Browser chunks are only 8 MiB. |

## Validation coverage

The implementation is covered by:

- byte-exact 8 MiB uploads through both Hub proxy routes;
- observation that upstream receives bytes before browser request completion;
- paced uploads lasting longer than `timeoutMs`;
- upload-idle timeout tests;
- lost-response retry and `409` offset recovery tests;
- interrupted-body resume tests;
- stale temporary-file cleanup tests;
- concurrent upload admission tests;
- real hub/spoke WebSocket upload end-to-end tests;
- slow-box fairness tests proving lifecycle RPC remains responsive;
- flow-controlled close and disconnect tests;
- old/new capability fallback tests;
- WebSocket proxy end-to-end tests; and
- restricted fake reverse-agent upload conformance tests.

Validation commands:

```sh
npm run build
npm test
cd llmbox
make check
make test-e2e-cluster
```

## Relevant files

| File | Responsibility |
|---|---|
| `public/src/lib/fileExplorerController.js` | Browser chunking, progress, and retry loop. |
| `public/src/lib/fileBrowserActions.js` | `/file-upload` request construction. |
| `server/http/routes/fileRoutes.mjs` | Offset validation, temporary files, finalization, cleanup. |
| `oyster-hub/workspace-proxy.mjs` | Shared streaming proxy, limits, timeouts, instrumentation. |
| `oyster-hub/ui-gateway.mjs` | UI workspace resolution and response scoping. |
| `oyster-hub/app.mjs` | Scoped workspace API routing. |
| `llmbox/internal/shared/cluster/proxy.go` | Transport-neutral `BoxDialer` interface. |
| `llmbox/internal/shared/cluster/stream.go` | Multiplexed stream and flow-control implementation. |
| `llmbox/internal/shared/cluster/proto.go` | Stream frames and capability wire protocol. |
| `plans/stream-workspace-file-uploads.md` | Completed implementation plan and decisions. |
