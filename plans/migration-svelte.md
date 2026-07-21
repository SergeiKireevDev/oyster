# Svelte Migration Plan

## Goal

Continue migrating the frontend from the legacy imperative `legacy.js` controller toward a Svelte/Vite component and store architecture while preserving existing behavior and keeping tests green.

## Principles

- Migrate incrementally: one component, modal, or behavior group at a time.
- Keep legacy business logic/RPC/fetch orchestration initially; move rendering/state into Svelte first.
- Prefer importable stores/components over `window.*` globals.
- Preserve existing DOM IDs where legacy code or tests depend on them.
- Remove unused features instead of migrating them.
- Validate after every meaningful change.

## Step-by-step Plan

### 1. Stabilize the Current Baseline ✅

Before starting another extraction, confirm the current tree is green:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

Expected baseline:

- Unit/server/UI tests pass.
- Docker image builds.
- E2E suite passes with parallel workers.

### 2. Audit Remaining Legacy UI Areas ✅

Identify remaining sections in `public/src/legacy.js` that still build DOM directly.

Categorize them by risk:

- Low risk: simple modal forms or prompts.
- Medium risk: session picker/search, file/editor flows.
- High risk: transcript/message rendering and streaming updates.

Use searches like:

```sh
rg "document\.createElement|innerHTML|appendChild|mBody|mActions" public/src/legacy.js
```

### 3. Remove Dead or Unused Features First ✅

Before migrating a feature, check whether it is still used.

If unused, remove:

- Legacy functions.
- Bridge handlers.
- Svelte components/stores if any were started.
- CSS blocks.
- Server routes used only by the removed UI.

Recent example: the unused Conversation Tree UI and `/session-tree` route were removed instead of migrated.

### 4. Migrate Small Modal Flows Next ✅

For each remaining small modal flow, follow the established pattern:

4.1. ✅ Add a store in `public/src/stores/<feature>.js`.
4.2. ✅ Add a component in `public/src/components/<Feature>Modal.svelte`.
4.3. ✅ Add bridge handlers in `public/src/lib/legacyBridge.js` only where Svelte must call legacy logic.
4.4. ✅ Update `Overlays.svelte` to render the modal by `modalState.content`.
4.5. ✅ Change `legacy.js` so it opens the modal and updates the store instead of building DOM.
4.6. ✅ Run validation.

Keep legacy fetch/RPC logic in `legacy.js` until the UI is stable.

### 5. Migrate the Session Picker in Phases ✅

The session picker is large and stateful, so do not migrate it in one pass.

Suggested phases:

5.1. ✅ Extract plain session list rendering.
5.2. ✅ Extract active/inactive grouping.
5.3. ✅ Extract fork family rendering/collapse.
5.4. ✅ Extract stop/delete session row actions through bridge handlers.
5.5. ✅ Extract search controls.
5.6. ✅ Extract search results rendering.
5.7. ✅ Move search state to a store.

Initially keep session switching, deleting, stopping, and searching logic in `legacy.js`.

### 6. Refactor Shared File-browser UI ✅

The folder browser, file picker, and file explorer now have similar Svelte structures.

After they remain stable, refactor duplicated rendering into reusable components such as:

- `PathHeader.svelte`
- `FileList.svelte`
- `DirectoryEntry.svelte`
- `HiddenToggle` action/helper

Do this after behavior is already covered and green; avoid combining refactors with feature migrations.

### 7. Migrate Extension UI Flows ✅

The extension UI bridge currently maps extension requests to prompts, confirms, selects, and editors.

For any remaining editor-specific UI:

7.1. ✅ Add a dedicated Svelte modal/store if needed.
7.2. ✅ Preserve the extension RPC response contracts exactly.
7.3. ✅ Keep `handleExtensionUI()` as the orchestration layer until all UI pieces are store-driven.

### 8. Prepare Transcript Migration ✅

Transcript rendering is high risk and should be prepared before extraction.

First extract pure utilities with tests:

- Message text extraction.
- Tool label formatting.
- Thinking block formatting.
- Markdown/body rendering helpers.
- Entry/message matching helpers for permalinks/search focus.

Avoid changing rendering behavior while extracting utilities.

### 9. Migrate Transcript Rendering Incrementally ✅

Do not rewrite transcript rendering all at once.

Suggested phases:

9.1. ✅ User message component.
9.2. ✅ Assistant message component.
9.3. ✅ Tool call/result component.
9.4. ✅ Thinking/collapsible block component.
9.5. ✅ Streaming assistant update path.
9.6. ✅ Permalink buttons.
9.7. ✅ Search-hit focus/flash behavior.

Keep SSE/RPC orchestration in `legacy.js` until rendering is fully store-driven.

### 10. Move App and Session State into Stores Gradually ✅

Move shared state only when a Svelte component needs it.

Completed store ownership:

- ✅ Current session/runner.
- ✅ Runner list/status.
- ✅ Workdir.
- ✅ Busy/streaming/connected state.
- ✅ Header/app display derived from app/session state.
- ✅ Composer text/button state derived from stores.
- ✅ Transcript message rendering is Svelte-owned from Step 9, with legacy retaining orchestration and chunk scheduling by design.

Avoid a large state rewrite.

### 11. Reduce Bridge Surface Over Time ✅

After each feature becomes fully Svelte-owned, remove unnecessary bridge functions.

Completed bridge reductions:

- ✅ Removed composer handlers/exports from `legacyBridge.js`; `Composer.svelte` now dispatches local DOM events consumed by `legacy.js` while composer UI state lives in Svelte stores.
- ✅ Removed header handlers/exports from `legacyBridge.js`; `Header.svelte` now reads app/session state directly and dispatches local DOM events for remaining legacy orchestration.
- ✅ `legacyBridge.js` shrank by the removed header/composer surface while legacy orchestration remains intact for actions not yet migrated.

Target direction:

- Svelte components import stores/actions directly.
- `legacyBridge.js` shrinks as `legacy.js` becomes smaller.

### 12. Periodic Cleanup

After several migrations:

- Remove unused helpers/imports from `legacy.js`.
- Remove stale CSS.
- Remove stale DOM IDs only if no tests or legacy code depend on them.
- Run `rg` for stale references.

Useful checks:

```sh
rg "removedName|oldId|oldFunction" public/src tests app.mjs
npm test
```

### 13. Validation Cadence

After every extraction:

```sh
npm run build
npm test
```

After behavior-affecting changes:

```sh
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

For visual/interactive changes, optionally run:

```sh
cd tests/e2e && E2E_VIDEO=1 npm test
```

## Recommended Next Target

Migrate the Session Picker, phase 1 only:

- Extract plain session list rendering into Svelte.
- Keep search, stop/delete, and switch logic in `legacy.js` initially.
- Validate before moving on to active/inactive grouping or search results.
