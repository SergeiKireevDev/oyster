# Stream Workspace File Uploads Across Oyster Hub and llmbox

## Goal

Make Oyster's existing resumable file upload reliable and memory-bounded across
both of these workspace data paths:

```text
browser
  -> Oyster Hub
  -> llmbox HTTP proxy
  -> hub/spoke WebSocket stream
  -> spoke DialBox
  -> Oyster :8080
```

```text
browser
  -> Oyster Hub
  -> llmbox HTTP proxy
  -> future /box/connect multiplexed stream
  -> cloud VM agent
  -> Oyster :8080
```

The browser upload protocol remains `POST /file-upload` with ordered 8 MiB raw
chunks, offsets, finalization, retry, and idempotent recovery. The work removes
avoidable buffering and timeout failures from the gateways; it does not replace
that protocol with a new upload API.

## Current behavior

- `public/src/lib/fileExplorerController.js` slices each selected file into 8 MiB
  chunks and retries failed chunks up to six times.
- `server/http/routes/fileRoutes.mjs` writes chunks into a temporary file,
  validates offsets, accepts already-applied retries, and atomically renames the
  completed upload.
- Oyster Hub currently buffers each complete request body before calling
  `fetch`, both in the UI gateway and the scoped workspace API gateway.
- The llmbox reverse proxy exposes the spoke tunnel as a `net.Conn`; it divides
  writes into 32 KiB `stream_data` frames, so HTTP uploads already work without
  an upload-specific cluster verb.
- The current Oyster Hub workspace timeout remains active while an upload body is
  forwarded and the workspace response is awaited. An 8 MiB chunk can therefore
  fail under the default timeout on a slow or congested link.
- llmbox stream bytes are JSON/base64 encoded. This is compatible but carries
  bandwidth and allocation overhead that should be measured before changing the
  cluster protocol.

## Non-negotiable contracts

- Preserve `/file-upload` query parameters, status codes, JSON response shapes,
  offset semantics, final rename behavior, and browser retry behavior.
- Preserve workspace scoping and authentication. A streamed body must never be
  forwarded before the target workspace has been resolved and authorized.
- Preserve bounded JSON-body parsing for routes whose scoped identities can
  appear inside JSON. Only opaque raw bodies may bypass deep body rewriting.
- Never buffer an entire file in Oyster Hub, llmbox Hub, or a spoke. Buffering at
  most one existing browser chunk in Oyster itself remains a compatibility
  boundary until the server upload route is separately redesigned.
- Backpressure must propagate from Oyster to the browser; gateways may not build
  unbounded queues when a spoke or agent is slow.
- A dropped response must remain safely retryable. Gateways may not replay a
  partially consumed request body themselves.
- SSE, WebSocket, JSON RPC, downloads, and ordinary workspace proxy behavior must
  remain unchanged.
- The data-plane interface must stay transport-neutral: the future cloud agent
  should satisfy the same raw bidirectional stream contract without requiring
  changes to Oyster's upload code.

## Validation for every implementation step

```sh
npm run build
npm test
cd llmbox && make check
```

Run the focused upload integration suite after every data-plane change. Run the
Docker cluster end-to-end suite before completion:

```sh
cd llmbox && make test-e2e-cluster
```

## 1. Characterize the Existing End-to-End Path

- [ ] Add an Oyster Hub integration fixture that sends a binary
  `POST /file-upload` request through `ui-gateway.mjs` to a fake workspace and
  verifies the body, query parameters, workspace credential replacement, and
  response are preserved byte-for-byte.
- [ ] Exercise multiple 8 MiB-compatible chunks through the gateway, including
  offset advancement, finalization, and a repeated chunk after a simulated lost
  response.
- [ ] Add a llmbox cluster test that sends a multi-frame HTTP request body through
  `Server` reverse proxy -> `remoteSpoke.DialBox` -> spoke stream -> target HTTP
  server and verifies exact bytes and response propagation.
- [ ] Cover stream interruption in the middle of a chunk and verify the Oyster
  upload endpoint retains only a retryable temporary file with the expected
  offset.
- [ ] Record baseline peak memory, elapsed time, and wire bytes for representative
  8 MiB and 64 MiB transfers over loopback. Keep the benchmark diagnostic rather
  than timing-sensitive in normal CI.

**Acceptance:** tests prove the currently intended browser-to-Oyster path before
buffering or timeout policy changes.

## 2. Introduce a Shared Workspace Request Proxy

- [ ] Extract the duplicated request forwarding in `oyster-hub/app.mjs` and
  `oyster-hub/ui-gateway.mjs` into one request-proxy module with injected
  workspace resolution, response scoping, timeout policy, and `fetch`.
- [ ] Separate target selection from body consumption so authentication,
  workspace scope, and URL rewriting complete before any body reaches the
  upstream workspace.
- [ ] Keep bounded buffering and deep scoped-identity decoding for
  `application/json` requests.
- [ ] Classify raw and multipart request bodies as opaque streams. Do not attempt
  to inspect or rewrite their bytes.
- [ ] Preserve redirect blocking, credential replacement, cookie stripping,
  hop-by-hop header removal, response scoping, and SSE transforms.
- [ ] Add contract tests proving both the standard UI route and
  `/api/v1/workspaces/{id}/...` use the same forwarding implementation.

**Acceptance:** there is one tested policy boundary for all workspace request
forwarding, with body handling selected only after the workspace is authorized.

## 3. Stream Upload Request Bodies Through Oyster Hub

- [ ] Forward opaque bodies with a Node/Web `ReadableStream` rather than a
  `Buffer`; set the Node fetch streaming requirement (`duplex: "half"`) only
  when a streaming body is present.
- [ ] Preserve `Content-Type` and valid `Content-Length` when possible; otherwise
  allow chunked transfer encoding without synthesizing an incorrect length.
- [ ] Propagate browser disconnect and upstream failure through one
  `AbortController`, destroying both sides without leaving a reader or writer
  alive.
- [ ] Ensure response streaming can begin as soon as upstream headers arrive and
  that no helper calls `arrayBuffer()`, `text()`, or equivalent on an opaque
  request body.
- [ ] Add a slow-upstream test that observes data before the browser has finished
  sending the whole chunk, proving the gateway no longer waits for full-body
  buffering.
- [ ] Add a memory regression test or deterministic stream instrumentation that
  proves the gateway never accumulates a complete large opaque request body.

**Acceptance:** Oyster Hub forwards upload bytes incrementally with end-to-end
backpressure and bounded memory.

## 4. Separate Connection, Upload, and Response Timeouts

- [ ] Extend Oyster Hub configuration with explicit workspace connection and
  upload policies. Keep the existing `timeoutMs` behavior for compatibility,
  while adding a longer upload timeout or idle timeout with a documented
  default.
- [ ] Apply the short connection timeout only until the upstream connection is
  established for bodyless requests. Do not treat normal upload duration as a
  connection failure.
- [ ] For uploads, reset an idle timer whenever request bytes make progress and
  apply a bounded response timeout after the final request byte is sent.
- [ ] Abort stalled browser reads, stalled upstream writes, and stalled final
  responses with distinct actionable errors that do not expose workspace
  credentials.
- [ ] Preserve retries by returning a gateway error rather than internally
  replaying a stream whose consumed prefix cannot be reconstructed.
- [ ] Document configuration for slow WAN/GPU-cloud links and add tests using a
  chunk whose transfer takes longer than the old default timeout but continues
  making progress.

**Acceptance:** a progressing upload is not killed by the normal request timeout,
while genuinely idle or wedged transfers remain bounded.

## 5. Verify llmbox Stream Backpressure and Fairness

- [ ] Add tests showing a slow box reader backpressures `remoteSpoke` writes
  without unbounded per-stream memory growth.
- [ ] Verify one large upload does not block unrelated verb responses, health
  requests, or a second stream for the duration of the transfer.
- [ ] Exercise clean close, remote close, hub disconnect, and spoke disconnect
  while upload data is queued; every participant must unblock and release its
  stream registry entry.
- [ ] Define observable counters for active streams, bytes transferred, stream
  duration, and close reason without logging body content or credentials.
- [ ] Benchmark the current 32 KiB JSON/base64 framing. Record CPU, allocations,
  and wire expansion before deciding whether binary WebSocket frames are needed.

**Acceptance:** the existing hub/spoke transport is demonstrably bounded and
fair under upload load, with enough measurement to justify any protocol change.

## 6. Add Binary Stream Framing Only If Measurement Requires It

- [ ] Establish an explicit performance threshold for changing the wire protocol;
  skip this section if current framing meets the documented target.
- [ ] If required, add cluster capability negotiation so old spokes continue to
  use JSON/base64 frames and upgraded peers can select `binary_stream_v1`.
- [ ] Define a bounded binary envelope containing frame type, stream ID, and raw
  payload while retaining JSON for enrollment and lifecycle RPC.
- [ ] Preserve per-stream ordering, interleaving, close errors, deadlines, and
  backpressure across mixed-version peers.
- [ ] Add compatibility tests for old hub/new spoke, new hub/old spoke, and
  reconnect after capability negotiation.
- [ ] Repeat the baseline measurements and retain the new framing only if it
  materially improves the target workload.

**Acceptance:** no incompatible protocol optimization is introduced without a
measured need and an explicit downgrade path.

## 7. Preserve Resumability and Bound Upload Resources

- [ ] Add gateway-level tests for a lost successful response followed by the
  browser retrying the same offset; the final file must contain each byte once.
- [ ] Test a reconnect that receives `409` with the workspace's current offset and
  resumes from that offset through Oyster Hub.
- [ ] Verify temporary upload files remain workspace-confined and cannot be
  redirected through encoded names, scoped query rewriting, or forwarded
  headers.
- [ ] Define and document limits for one chunk, total concurrent upload streams,
  and upload idle lifetime. Preserve the existing 100 MiB raw request ceiling as
  a defense-in-depth upper bound even though browser chunks are 8 MiB.
- [ ] Clean abandoned temporary uploads through an explicit age-based policy;
  never delete an active upload or a completed target file.

**Acceptance:** retries remain idempotent through every gateway and abandoned
uploads cannot consume resources indefinitely.

## 8. Make the Contract Reusable by Direct Cloud Agents

- [ ] Define a transport-neutral box stream interface equivalent to
  `DialBox(ctx, boxID, port) (net.Conn, error)` and make the llmbox reverse proxy
  depend only on that interface.
- [ ] Add a conformance suite that can run against the current spoke tunnel and
  the future `/box/connect` agent multiplexer.
- [ ] Include raw upload, download, SSE, WebSocket upgrade, cancellation,
  half-close behavior, and concurrent streams in the conformance suite.
- [ ] Require a cloud agent stream to dial only the authenticated box's localhost
  ports; no upload metadata may broaden that destination.
- [ ] Prove with a fake reverse agent that Oyster's existing `/file-upload`
  protocol works unchanged when the backing stream no longer passes through a
  spoke.

**Acceptance:** direct cloud VMs can adopt the stream interface without adding a
cloud-specific Oyster upload route or changing the browser.

## 9. Complete Operational Validation

- [ ] Run the complete Oyster unit suite, production build, llmbox checks, and
  cluster end-to-end tests.
- [ ] Run a real browser upload through Oyster Hub into an Oyster process in a
  Docker-backed llmbox and verify file hash, size, progress, and retry behavior.
- [ ] Test representative slow and interrupted links with traffic shaping and
  confirm bounded memory, progress-based timeout behavior, and successful
  resume.
- [ ] Verify simultaneous upload, transcript SSE, and Oyster RPC traffic remain
  responsive.
- [ ] Update Oyster Hub and llmbox documentation with the data path, timeout
  settings, resource limits, diagnostics, and cloud-agent compatibility
  contract.

## Completion criteria

- Oyster file uploads traverse Oyster Hub and the current llmbox hub/spoke link
  without buffering a complete file or complete browser chunk in Oyster Hub.
- Slow but progressing chunks survive; idle, disconnected, and wedged transfers
  terminate within documented bounds.
- Offset retries and finalization remain byte-exact and idempotent across lost
  responses and reconnects.
- The llmbox stream remains bounded, fair, observable, and compatible with SSE,
  WebSockets, downloads, and lifecycle RPC.
- Any binary framing change is capability-negotiated and measurement-driven.
- The future direct-cloud box agent can satisfy the same raw stream conformance
  suite without changes to Oyster's browser or `/file-upload` endpoint.
