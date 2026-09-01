# Reliable File and Stream I/O

## Goal

Bound memory and event-loop delay for SSE, file browsing, saving, uploads, and
session catalog work. Make concurrent uploads independent and retries
content-aware, while preserving file metadata during browser edits.

This plan complements the completed Oyster Hub streaming work: the gateway can
stream bytes with backpressure, but the destination Oyster process still needs
safe per-client SSE queues and a concurrency-safe upload protocol.

## Guardrails

- Preserve path confinement, denied roots, authentication, workspace scoping,
  response shapes, and atomic final rename.
- Backpressure must propagate or cause a deliberate bounded disconnect; never
  accumulate an unbounded queue for a slow client.
- A resumable upload has an explicit identity independent of destination name.
  Two clients uploading the same name must not share a temporary file.
- Retry acceptance must verify content, not only resulting file size.
- Never delete an active upload during stale-file cleanup.
- Preserve an existing file's permission bits across browser saves. New files
  use a documented restrictive mode and normal ownership.
- Move large filesystem work off the event loop incrementally and measure the
  result. Do not replace bounded synchronous SQLite transactions merely for
  stylistic consistency without evidence.

## 1. Add Stream and Event-Loop Instrumentation

- [ ] Add diagnostics for per-SSE-client `writableLength`, queued event bytes,
  oldest queued age, dropped/disconnected clients, upload bytes in flight,
  active uploads, and event-loop delay percentiles.
- [ ] Add deterministic slow-response fixtures where `res.write()` returns
  false and `drain` is manually controlled.
- [ ] Add load diagnostics for concurrent transcript output, a large JSONL
  search, file content reads, and upload finalization.
- [ ] Define explicit budgets for per-client queued bytes, global queued bytes,
  upload concurrency, chunk size, idle age, and maximum event-loop delay under
  representative load.

**Acceptance:** tests can observe pressure and enforce queue/resource bounds
without timing-sensitive sleeps.

## 2. Implement SSE Backpressure

- [ ] Introduce one SSE client abstraction used by global events, runner events,
  replay, initial state, and heartbeat writes.
- [ ] Stop writing after `res.write()` returns false. Queue only up to the
  configured byte/event cap and resume on `drain`.
- [ ] Coalesce replaceable state notifications where safe, but never reorder
  transcript/RPC events. If a lossless queue exceeds its cap, disconnect the
  client with an observable close reason and let normal replay/reload restore
  state.
- [ ] Bound replay separately so a dormant or slow client cannot enqueue the
  entire retained history while live events continue.
- [ ] Remove queue/listener/timer state on close, abort, error, reload, and
  server shutdown.

**Acceptance:** a blocked client stays within its cap and does not delay or grow
memory for healthy clients; reconnect reconstructs consistent state.

## 3. Give Every Upload a Unique Identity

- [ ] Extend the browser upload protocol with a cryptographically random
  `uploadId` for every selected file. Use a unique private temporary file and a
  confined manifest under the destination directory or an Oyster-owned upload
  directory.
- [ ] Track upload ID, canonical destination, expected offset, created/updated
  times, and chunk digests. Reject reuse of an upload ID for another destination.
- [ ] Open new temporary files exclusively with restrictive permissions and
  reject symlinks/non-regular files. Keep manifests and temporary files out of
  normal browse responses.
- [ ] Add a bounded active-upload registry and destination-finalization lock.
  Concurrent uploads to the same target may transfer independently, but only
  the explicitly finalized upload may atomically replace the destination.
- [ ] Keep legacy no-ID uploads only behind a documented compatibility path
  serialized by destination; set and test a removal milestone.

**Acceptance:** concurrent uploads with the same filename cannot truncate,
append to, finalize, or clean up one another's data.

## 4. Make Resume and Retry Content-Aware

- [ ] Include a chunk digest and expected length in each request. Verify the
  bytes received before advancing the manifest offset.
- [ ] For a retry below the current offset, read and hash the corresponding
  stored range; accept only an exact match. A size comparison alone is never
  sufficient.
- [ ] Return stable conflict data containing upload ID and current offset, but
  no server path outside the existing authenticated file-browser contract.
- [ ] Fsync file content and its directory at finalization where durability is
  promised, then atomically rename under the destination lock and mark the
  manifest complete.
- [ ] Make lost-final-response retries idempotently return the same completion
  result after verifying upload identity and final digest.
- [ ] Clean stale uploads by manifest age only when they are absent from the
  active registry; remove manifest and data together.

**Acceptance:** interruption, retry, duplicate final chunk, process restart,
and response loss produce each byte exactly once or a recoverable conflict.

## 5. Preserve Metadata During Browser Saves

- [ ] Before replacing an existing regular file, capture its permission bits
  and relevant metadata policy. Reject symlinks and type changes after path
  validation.
- [ ] Create the temporary file exclusively in the same directory, write and
  fsync content, apply the preserved mode, then rename and fsync the directory.
- [ ] Define behavior for ownership, ACLs, xattrs, and platforms that cannot
  preserve them. At minimum, never silently remove executable bits.
- [ ] For a new file, use a documented mode derived from a restrictive default
  and process umask.
- [ ] Add tests for executable files, read-only files, concurrent replacement,
  symlink swaps, write failure, and rename failure cleanup.

**Acceptance:** editing an executable preserves its executable mode and failed
saves leave the original file and metadata intact.

## 6. Move Large Work Off the Event Loop

- [ ] Convert route-level directory listing, editable-file reads/writes, stale
  upload cleanup, and upload appends to `node:fs/promises` or streaming APIs.
- [ ] Parameterize JSONL catalog I/O behind async operations. Preserve ordering,
  cache invalidation, active-branch semantics, and path confinement while
  moving large parsing/search to a bounded worker pool when measurement
  justifies it.
- [ ] Stream upload request bodies to the unique temporary file with an explicit
  byte cap instead of buffering up to the raw-body ceiling before a synchronous
  write.
- [ ] Add cancellation so disconnected requests release file descriptors,
  worker jobs, and upload slots.
- [ ] Keep synchronous startup-only reads where they are small and documented;
  add a static inventory so new synchronous request-path I/O is reviewed.

**Acceptance:** large search/upload/file operations keep heartbeats and unrelated
requests responsive within the recorded event-loop budget.

## 7. Validate Resource Bounds End to End

- [ ] Add concurrent same-name upload, resume, stale cleanup, symlink-race, and
  mode-preservation route tests.
- [ ] Use `autocannon` for diagnostic HTTP/upload load and Clinic.js or
  `perf_hooks.monitorEventLoopDelay()` for event-loop investigation.
- [ ] Use Toxiproxy or deterministic throttled streams for slow SSE clients,
  interrupted uploads, and delayed workspace responses.
- [ ] Run simultaneous upload, transcript SSE, RPC, browse, and search through
  direct Oyster and Oyster Hub/llmbox paths.
- [ ] Run unit, build, Docker, full browser e2e, and llmbox cluster validation.

## Completion criteria

- Every SSE client has bounded queue memory and tested drain/disconnect behavior.
- Resumable uploads are isolated by upload ID and exact-content retry checks.
- Stale cleanup cannot remove active transfers.
- Browser saves preserve existing executable permissions and fail atomically.
- Large filesystem and catalog work stays within documented event-loop and
  memory budgets under concurrent traffic.
