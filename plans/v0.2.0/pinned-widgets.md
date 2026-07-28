# Overhaul Hublots as Pinned Widgets

## Goal

Replace the right-sidebar Hublot card list with **Pinned Widgets**: a durable,
ordered, phone-style launcher for useful session and workspace artifacts.

A pinned widget can point to:

- a managed live interface (the current hublot capability);
- a workspace file, including image and video artifacts;
- a workspace directory or the built-in file explorer;
- an authenticated Oyster view or a deliberately pinned HTTPS link.

The sidebar presents compact app-like tiles with an approximately `50px × 50px`
visual and a short label. Image and video tiles use a real thumbnail and open a
dedicated media viewer. Users can reorder tiles and place them into one-level
folders/groups, with touch, pointer, keyboard, and menu-based alternatives.

“Hublot” remains the internal name for the managed local-service + Cloudflare
lifecycle during migration. In user-facing application copy, the umbrella
feature is “Pinned Widgets” and a hublot is described as a **live interface
widget** only where its public-tunnel behavior matters.

## Product Contract

### Pinning is not ownership

- Pinning records a durable reference; it does not copy, move, publish, or take
  ownership of the target artifact.
- Unpinning never deletes a file, closes a tunnel, or tears down a routine.
- Closing a live interface is a separate, explicit action. Its pin remains in an
  unavailable state until the user unpins it; an expired Quick Tunnel URL is
  never reopened or advertised as live.
- A missing or moved file remains visible as unavailable with repair/unpin
  actions. Oyster must not silently discard the pin.
- Local artifacts are served through authenticated Oyster routes. Pinning a file
  must never create a Cloudflare tunnel or public URL.

### Scope and identity

- Every widget is either session-scoped or workspace-scoped. The default is the
  active session; “Pin for workspace” is an explicit secondary action.
- A group has the same scope as its children. Moving a widget across scope is an
  explicit operation, and a group cannot mix session and workspace widgets.
- A file reference stores the owning workspace identity and canonical path plus
  a last-known stat fingerprint. The widget ID, not the path, is the durable UI
  identity. This is a reference model, not the future full artifact/provenance
  registry.
- Hub DTOs retain opaque, workspace-scoped IDs. The Hub routes every pin,
  preview, reorder, and group mutation to the target workspace; paths alone
  never select a workspace.
- Ordering is durable and deterministic. Use server-assigned sortable positions
  and transactional normalization rather than browser array order as authority.

### Supported widget kinds for the first release

| Kind | Tile | Primary action | Secondary actions |
|---|---|---|---|
| `live_interface` | status-aware app icon; no eager iframe | open public HTTPS URL | close interface, inspect status, unpin |
| `image` | cropped image thumbnail | open image viewer | download, reveal in files, unpin |
| `video` | poster/first-frame thumbnail with play badge | open video player | download, reveal in files, unpin |
| `file` | MIME/extension icon | open existing editor/preview when supported, otherwise download | reveal in files, unpin |
| `directory` | folder icon | open file explorer at directory | unpin |
| `builtin` | Oyster-owned icon | invoke registered in-app action | unpin when allowed |
| `link` | safe fallback/site icon | open in a new tab | edit label, unpin |

Audio, generated document previews, arbitrary HTML embedding, nested groups,
cross-workspace groups, automatic filesystem-wide artifact discovery, and
server-generated image/video transcoding are not required for the first
release. The schema and renderer registry should permit later kinds without
putting kind-specific conditionals into the layout shell.

## Interaction and Visual Design

- Rename the right rail heading and mobile drawer label to **Pinned Widgets**.
  Keep Routines as a separate section below it for this release.
- Render tiles in a responsive CSS grid using an approximately 50px square
  visual, a one- or two-line label, and a minimum 44px touch target. The rail
  should usually show three columns at its current width.
- Do not load an iframe for every live interface. Use an icon plus opening,
  ready, failed, or closed status treatment; this avoids third-party execution,
  tracking, focus, and bandwidth merely from opening the sidebar.
- Image tiles use `object-fit: cover`. Video tiles use an authenticated media
  source, a poster or first decodable frame, and a play badge. Loading is lazy,
  and off-screen previews must not download complete large videos.
- Selecting an image opens a dedicated modal/lightbox with fit-to-screen,
  original-size/zoom, download, reveal, previous/next media, and close actions.
  Selecting a video opens a dedicated modal with native controls, seeking,
  fullscreen, poster, duration when known, and previous/next media.
- A group appears as a folder tile with a compact preview mosaic and item count.
  Selecting it opens an in-rail folder view (title, back button, child grid),
  matching a phone launcher without nesting groups recursively.
- Pointer drag reorders and drops onto groups. Touch uses a deliberate long
  press and visible drag state so vertical drawer scrolling remains reliable.
  Every drag operation has accessible menu equivalents: “Move to group,”
  “Remove from group,” and ordered move actions. Escape cancels a drag.
- Long press, context menu, or an overflow button exposes rename, scope, reveal,
  close-live-interface, move, and unpin actions as applicable. Destructive
  lifecycle actions are visually and semantically separate from unpinning.
- The add tile opens a **Pin widget** sheet with recent workspace files, file
  browser, live-interface creation, HTTPS link, built-ins, and new-group actions.
  The file explorer also gets a direct Pin/Unpin action on every file and folder.

## Media Delivery and Security Contracts

- Add a same-origin authenticated media route rather than reusing
  `/file-download`, which intentionally forces `application/octet-stream` and
  attachment disposition.
- Resolve the widget first, then resolve and revalidate its target against the
  allowed workspace roots on every request. Never accept an unscoped arbitrary
  path from a thumbnail or media URL.
- Stream files; never read a complete media file into memory. Implement `HEAD`,
  single byte ranges, `206`, `Content-Range`, `Accept-Ranges`, correct
  `Content-Length`, conditional validation (`ETag` or last-modified), abort on
  client disconnect, and a bounded open-file lifecycle so browser video seeking
  works through direct Oyster and Hub proxies.
- Inline only an explicit safe image/video MIME allowlist, set
  `X-Content-Type-Options: nosniff`, and use a restrictive media response policy.
  SVG is permitted only through a dedicated inert `<img>` viewer with a sandboxed,
  no-script response policy. HTML, scripts, unknown binary formats, and
  MIME/extension disagreements fall back to download/generic-file behavior.
- Do not put bearer tokens or absolute filesystem paths in media URLs. Browser
  navigations use the existing same-origin authenticated cookie and, under Hub,
  an opaque workspace-scoped widget ID.
- The first release may render image thumbnails from the original streamed image
  and video thumbnails from browser metadata/first-frame capture. Keep the
  thumbnail URL/metadata contract separate so bounded server-generated cached
  thumbnails can be added later without changing widget records or components.
- Only explicit `https:` links can be pinned. Open them with `noopener`; never
  iframe arbitrary external links in the sidebar or viewer.

## Durable Data Model

Add a migration after the current application-store schema. Exact names may
follow repository conventions, but preserve these boundaries:

```text
pinned_widget_groups
  id, owner_id/session scope, workspace scope, name, position,
  created_at, updated_at

pinned_widgets
  id, owner_id/session scope, workspace scope, group_id nullable,
  kind, label, position,
  target reference fields (hublot id, canonical file path, builtin key, or URL),
  last-known MIME/stat metadata,
  created_at, updated_at
```

- Use check constraints for kind/scope/reference combinations and foreign keys
  for session, group, and hublot references where lifecycle semantics permit.
- A hublot FK must not cascade-delete its widget. Closing/deleting lifecycle
  history leaves the pin available to report its closed state.
- File deletion is not a database cascade. Resolve availability at read time and
  expose `ready`, `missing`, `closed`, `opening`, or `error` separately from the
  durable widget definition.
- Repository transactions own create, rename, move, group, ungroup, reorder,
  scope change, and delete. Reordering a set or moving into/out of a group is one
  transaction.
- Backfill one `live_interface` widget for every non-pool hublot whose desired
  state is open or whose persisted state is not closed. Preserve session
  ownership and creation order. New hublots automatically receive one pin.
- Seed the file explorer as a non-duplicated built-in widget through an explicit
  product default or virtual widget policy; do not create it opportunistically
  on every list request.

## HTTP and Event Contracts

Introduce a typed pinned-widget API instead of expanding `/tunnels` into a
mixed artifact endpoint:

```text
GET    /pinned-widgets?sessionId=…&scope=session|workspace|all
POST   /pinned-widgets
PATCH  /pinned-widgets
DELETE /pinned-widgets?id=…
POST   /pinned-widget-groups
PATCH  /pinned-widget-groups
DELETE /pinned-widget-groups?id=…
GET|HEAD /pinned-widget-media?id=…
```

- Mutations return the authoritative affected widget/group ordering so clients
  do not guess positions after concurrent changes.
- Validate widget-kind payloads with a central discriminator and return stable
  errors for unsupported kind, target outside roots, stale group, scope
  mismatch, duplicate live-interface pin, and conflict/reorder revision.
- Return render-ready DTOs with opaque ID, kind, label, group, order, scope,
  availability, media category, safe media URL, and kind-specific actions. Do
  not expose service scripts, process identity, credentials, or stale public
  URLs.
- Emit `pinned_widget_created`, `pinned_widget_updated`,
  `pinned_widget_deleted`, and `pinned_widgets_reordered` events. Existing tunnel
  lifecycle events update the associated live-interface tile without requiring
  a full refresh.
- Extend Oyster Hub aggregation/scoping and `openapi.json`; verify direct spoke,
  llmbox, and cloud workspace routing. The Hub must not merge ordering from
  different workspaces into one writable group.
- Keep `/tunnels` and tunnel SSE contracts intact while clients and extensions
  migrate. Widget operations call the hublot lifecycle service when the user
  explicitly requests live-interface close; they do not duplicate process
  management.

## Implementation Plan

Each numbered section is one verified commit. Preserve unrelated changes and run
both commands after every section:

```sh
npm run build
npm test
```

### 1. Freeze the Widget Domain and Migration Contract

- [ ] Add repository-level domain fixtures for each widget kind, session and
  workspace scope, groups, availability, and ordering.
- [ ] Add the SQLite migration, constraints, indexes, widget/group repositories,
  hydration, and transaction operations.
- [ ] Backfill eligible hublots idempotently and seed the built-in file explorer
  without duplicates on restart or hot reload.
- [ ] Verify session cascade behavior, closed-hublot reference behavior, group
  scope constraints, concurrent reorder normalization, and SQLite/JSONL session
  backends.

**Acceptance:** widget identity, grouping, scope, and ordering survive server
restart and application hot replacement without changing tunnel lifecycle data.

### 2. Add Pinned Widget Routes and Hub Scoping

- [ ] Add focused route modules and route-table wiring for list, pin, rename,
  move, group, ungroup, reorder, scope change, and unpin.
- [ ] Centralize target validation and derive availability/action DTOs without
  leaking sensitive hublot or path details.
- [ ] Add SSE events and connect existing hublot events to live-interface widget
  updates.
- [ ] Extend Hub workspace proxy/scoping and OpenAPI documentation for all new
  resources and opaque IDs.
- [ ] Add direct and Hub route tests for authentication, workspace isolation,
  invalid references, conflicts, atomic ordering, and error shapes.

**Acceptance:** clients can durably manage an ordered grouped widget collection
in one workspace without changing or closing the referenced artifacts.

### 3. Implement Safe Media Streaming

- [ ] Classify pinned file MIME/category using one server policy; render SVG only
  through its inert sandboxed image viewer, and keep HTML, unknown, and
  mismatched content non-inline.
- [ ] Implement authenticated widget-ID media `GET`/`HEAD`, streaming, byte
  ranges, cache validators, disconnect cleanup, and safe headers.
- [ ] Preserve range and response streaming through Oyster Hub and llmbox/cloud
  workspace proxies without whole-file buffering.
- [ ] Add tests for images, video seek ranges, zero-length and large files,
  missing/replaced targets, traversal/symlink escapes, disallowed active media,
  malformed/multiple ranges, auth, and remote workspace scoping.

**Acceptance:** a browser can seek a large pinned video and render a pinned image
without public exposure, path-based authorization, unsafe inline content, or
whole-file buffering in any gateway.

### 4. Replace the Hublot Rail with the Widget Grid

- [ ] Create a `features/pinned-widgets/` runtime, stores, API actions, and
  instance-scoped controller; do not extend the old hublot component with a
  growing kind switch.
- [ ] Replace `HublotSidebar.svelte`/`HublotList.svelte` with a Pinned Widgets
  rail composed from a tile renderer registry and reusable tile shell.
- [ ] Render the responsive phone-style grid, ~50px visuals, labels, lazy media
  thumbnails, live status, unavailable state, add tile, loading, and empty state.
- [ ] Remove eager hublot iframes and preserve live-interface open/close behavior
  through explicit widget actions.
- [ ] Update mobile drawer/carousel labels and behaviors while keeping Routines
  separate and preserving checkpoint/sidebar mutual exclusion.
- [ ] Add component, store, event, DOM-reference, light/dark theme, narrow mobile,
  and keyboard-focus tests.

**Acceptance:** the right sidebar is a compact, accessible Pinned Widgets grid;
current hublots appear as live-interface tiles and no interface executes merely
because the rail is visible.

### 5. Add Dedicated Image and Video Displays

- [ ] Add an Oyster-owned media-viewer modal with separate image and video
  renderers, loading/error/missing states, and native video controls.
- [ ] Implement image fit/zoom, fullscreen where supported, media previous/next,
  download, and reveal-in-file-explorer actions.
- [ ] Use lazy thumbnail loading and bounded video metadata/first-frame behavior;
  cancel requests and release object/media resources when tiles or viewers
  unmount.
- [ ] Preserve modal focus trap, return focus, Escape, screen-reader names, touch
  controls, safe-area insets, orientation changes, and reduced motion.
- [ ] Add UI and browser-policy tests proving media opens in the viewer while
  generic files retain edit/download behavior.

**Acceptance:** every supported pinned image/video has a recognizable tile and
opens in its own secure, responsive display rather than an iframe or forced
download.

### 6. Add Phone-Style Groups and Reordering

- [ ] Add create, rename, open, close, and delete-empty-group UI; deleting a
  non-empty group requires choosing “ungroup items” or cancelling.
- [ ] Render group mosaic/count tiles and an in-rail one-level folder view with a
  stable back action and restored focus.
- [ ] Implement pointer drag reorder/grouping with optimistic visuals but commit
  only server-authoritative order.
- [ ] Implement touch long-press without breaking scroll, plus keyboard/menu
  move, group, ungroup, and ordered movement alternatives.
- [ ] Handle concurrent updates, reconnect during drag, target deletion, scope
  mismatch, cancellation, and rollback with an actionable toast.
- [ ] Add controller/component tests for all input modes and repository/route
  tests for each atomic move.

**Acceptance:** users can organize widgets like phone apps using one-level
folders, and every operation is durable and fully usable without drag-and-drop.

### 7. Add Pinning Entry Points and Live-Interface Compatibility

- [ ] Add Pin/Unpin actions to file explorer files and directories, preserving
  the active Hub workspace and current session scope.
- [ ] Replace the hublot manager entry point with the Pin Widget sheet while
  retaining live-interface creation, progress, failure, explicit close, and
  session/workspace scope controls.
- [ ] Auto-pin newly created live interfaces exactly once, including those
  opened by an agent extension or one-shot session, and reconcile the pin after
  session rebinding.
- [ ] Add label editing, duplicate-target handling, reveal, download, repair
  missing file reference, and workspace-scope actions.
- [ ] Verify deleting a session affects only session-scoped widgets and existing
  hublot/routine cleanup summaries remain accurate.

**Acceptance:** any browsable workspace artifact can be pinned in place, and all
existing ways to create a hublot produce one correctly scoped live-interface
widget without conflating unpin and close.

### 8. Rename the Public Surface and Complete Compatibility

- [ ] Add a pinned-widget extension/tool for pin, unpin, list, group, and
  live-interface operations. Keep `hublot` as a deprecated compatibility alias
  for at least one release so saved prompts and older agents continue to work.
- [ ] Update extension prompt snippets, `AGENTS.md`, README, user guide,
  installation/configuration, HTTP reference, screenshots, and UI copy. Define
  “live interface” and disclose Cloudflare only for that widget kind.
- [ ] Keep configuration/env names and internal tunnel APIs compatible unless a
  separately documented deprecation has a measurable benefit.
- [ ] Add upgrade tests from a pre-widget database, compatibility tests for the
  old `/tunnels` API/tool, and a claim inventory proving pin, group, media view,
  close, restart, reconnect, and mobile workflows.
- [ ] Run the complete suite and manually verify desktop, narrow phone, touch
  grouping, keyboard-only grouping, Hub remote workspace media, dark/light
  themes, server restart, and hot reload.

**Acceptance:** users and agents see Pinned Widgets consistently, existing
hublot automation still works, and upgrade neither publishes artifacts nor loses
active interfaces.

## Completion Criteria

- The right sidebar is a phone-style, durable grid of approximately 50px widget
  visuals with labels, ordering, and one-level groups.
- Any file or directory visible in Oyster's allowed workspace roots can be
  pinned; image and video artifacts receive thumbnails and dedicated displays.
- Managed hublots appear as live-interface widgets without eager iframes, while
  tunnel creation/close/recovery remains backward compatible.
- Pin/unpin, artifact lifecycle, and public tunnel lifecycle are separate and
  clearly communicated.
- Widget/group state survives restart, hot reload, session switches, Hub routing,
  and reconnects; unavailable targets remain honest and actionable.
- Media delivery is authenticated, workspace-scoped, range-capable,
  memory-bounded, MIME-restricted, and never creates public exposure.
- Pointer, touch, keyboard, and assistive-technology users can open, reorder,
  group, ungroup, and remove widgets.
- `npm run build` and the complete `npm test` suite pass.
