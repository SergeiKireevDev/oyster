# Step 9 Transcript Migration Plan

## Goal

Migrate transcript/message rendering from imperative DOM construction in `public/src/legacy.js` to Svelte components and stores, without changing SSE/RPC/session orchestration yet.

The migration must preserve current behavior:

- User, assistant, custom, tool call, tool result, and thinking rendering.
- Streaming assistant updates without flicker.
- Tool execution partial/final updates.
- Tail-first transcript loading with chunked backfill.
- Scroll pinning and reading-position preservation.
- Prompt history replay behavior.
- Checkpoint iceberg placement.
- Permalink copy/focus behavior.
- Search-hit jump and flash behavior.
- Existing DOM selectors used by tests: especially `#messages`, `.msg.user`, `.msg.assistant`, `.block.tool`, `.block.thinking`, `.permalink`, `.checkpoint`.

## Progress

Completed so far:

- ✅ 9.1 transcript store/passive renderer scaffold.
- ✅ 9.2 user message rendering via Svelte, including interface briefing rendering.
- ✅ 9.3 static assistant text/thinking rendering via Svelte for compatible assistant messages.
- ✅ 9.4 tool call/result cards via Svelte-backed stores.
- ✅ 9.5 streaming assistant update path for text/thinking-only assistant messages.
- ✅ Extracted and tested `splitTurns()` / `takeTailChunk()` in `public/src/lib/transcriptUtils.js`.
- ✅ Full validation passed after the latest tranche: `npm run build`, `npm test`, `docker build -t pi-lot-ui .`, and full e2e.
- ✅ 9.7 checkpoint iceberg now renders through `CheckpointButton.svelte`; legacy still owns checkpoint API orchestration and placement.
- ✅ 9.8 permalink UI has a shared `PermalinkButton.svelte` for Svelte-rendered user/assistant messages; legacy fallback remains for non-migrated transcript paths.

Still remaining:

- 9.6 store-owned tail-first transcript/backfill path.
- 9.8 data-driven permalink entry alignment and fallback cleanup.
- 9.9 search-hit focus/flash refactor.
- 9.10 final cleanup of replaced imperative transcript DOM code.

## Non-goals for Step 9

Do not move these yet unless absolutely required:

- SSE connection lifecycle.
- RPC/fetch orchestration.
- Runner/session switching.
- Checkpoint API calls.
- Search API calls.
- Composer prompt submission orchestration.
- App/session state ownership beyond the transcript-specific store.

Those belong to later app/session state and bridge-reduction steps.

## Current Legacy Surface to Replace

Primary transcript code in `public/src/legacy.js`:

- `renderBlockEl()`
- `renderAssistantInto()`
- `addUserMessage()`
- `addAssistantContainer()`
- `renderFullMessage()`
- `clearMessages()`
- `splitTurns()`
- `takeTailChunk()`
- `renderChunk()`
- `renderTranscript()`
- `createToolCard()`
- `updateToolCard()`
- `renderToolArgs()`
- `finishToolCard()`
- `toolCards` map
- `liveAssistant`
- tool streaming handlers in `handleEvent()`
- permalink helpers that inspect rendered message elements
- checkpoint placement via `placeCheckpointBtn()`

Existing extracted helpers in `public/src/lib/messageUtils.js` should be reused and expanded with tests before changing UI behavior.

## Design Direction

Introduce a transcript store that represents renderable transcript items, while legacy continues to decide *when* to load, stream, switch sessions, and fetch canonical messages.

Proposed files:

- `public/src/stores/transcript.js`
- `public/src/components/Transcript.svelte`
- `public/src/components/transcript/UserMessage.svelte`
- `public/src/components/transcript/AssistantMessage.svelte`
- `public/src/components/transcript/MessageBlock.svelte`
- `public/src/components/transcript/ToolCard.svelte`
- `public/src/components/transcript/ThinkingBlock.svelte`
- `public/src/components/transcript/PermalinkButton.svelte`
- `public/src/components/transcript/CheckpointButton.svelte` or a legacy bridge placeholder if checkpoint logic remains imperative initially

The Svelte transcript should render inside the existing `#messages` container or preserve that ID on the transcript root so tests and legacy selectors keep working.

## Store Shape Draft

Keep this minimal and pragmatic. Example draft:

```js
{
  items: [
    {
      key,
      role: "user" | "assistant" | "custom" | "toolResult",
      message,
      text,
      blocks,
      entryRole,
      isInterfaceBriefing,
    }
  ],
  toolResultsById: {
    [toolCallId]: { text, isError, status }
  },
  liveAssistantKey: null,
  renderJob: 0,
  fullyBackfilled: false,
  checkpointTargetKey: null,
  flashEntryId: null,
}
```

Do not over-design this into global app state. Keep it transcript-specific.

## Phase Plan

### 9.1 Add transcript store and passive Svelte renderer ✅

- Add `stores/transcript.js` with methods that mirror legacy operations but do not wire them yet:
  - `resetTranscript()`
  - `appendMessage(message)`
  - `appendMessages(messages)`
  - `prependMessages(messages)`
  - `updateAssistant(key, message)`
  - `updateToolCall(toolCall)`
  - `updateToolResult(toolCallId, result, isError)`
  - `setCheckpointTarget(key)`
- Add `Transcript.svelte` rendered by `ChatLayout.svelte` at the existing message location.
- Initially keep legacy DOM rendering active; guard the Svelte transcript behind an internal flag or keep the component mounted with empty state.
- Acceptance:
  - No visible UI change.
  - `npm run build && npm test` passes.

### 9.2 Migrate static user message rendering ✅

- Add `UserMessage.svelte`.
- Preserve:
  - `.msg.user`
  - `data-role="user"`
  - plain text rendering semantics
  - interface briefing collapsed tool-like rendering for `Opening interface: ...`
  - permalink button location/selector, even if click still bridges to legacy
- Change `addUserMessage()` to update the transcript store for user messages, while keeping prompt history and scroll side effects in legacy.
- Add unit/component-adjacent tests where practical for user text/interface briefing transformation.
- Acceptance:
  - User messages display identically.
  - Prompt recall still works.
  - E2E session tests still pass.

### 9.3 Migrate static assistant text/thinking rendering ✅

- Add `AssistantMessage.svelte`, `MessageBlock.svelte`, and `ThinkingBlock.svelte`.
- Preserve:
  - `.msg.assistant`
  - `data-role="assistant"`
  - markdown output from existing `renderMarkdown()` or an extracted equivalent
  - thinking block visibility based on `localStorage.pi_thinking_visible`
  - thinking `<details>` open-state preservation where possible
  - assistant error rendering for `stopReason === "error"`
- Keep streaming updates in legacy until static reload behavior is stable.
- Acceptance:
  - Reloaded transcripts render user/assistant text and thinking correctly.
  - Existing UI/unit/e2e tests pass.

### 9.4 Migrate tool call and tool result cards ✅

- Add `ToolCard.svelte`.
- Preserve:
  - `.block.tool`
  - `.tname`, `.targ`, `.status`, `.args-pre`, `.result-pre`
  - edit diff rendering for `edit` tool arguments
  - result truncation at current limit
  - running/ok/error status behavior
  - partial update behavior
- Replace `toolCards` DOM map with store state keyed by `toolCallId`.
- Legacy event handlers should call store methods instead of mutating DOM nodes.
- Acceptance:
  - Hublot/routine/tool-heavy e2e tests pass.
  - Tool partial/final output updates in place.

### 9.5 Migrate streaming assistant update path ✅

- Replace `liveAssistant = { root, msg }` DOM ownership with a store-owned live assistant item.
- Legacy SSE handlers still assemble/update message objects, but commit updates to the transcript store.
- Preserve incremental update semantics:
  - changed/growing block updates without full transcript flicker
  - scroll-to-bottom only when currently pinned or when legacy already did it
  - no duplicate local echo user messages
- Acceptance:
  - Live assistant responses stream visibly.
  - Sending prompts still avoids duplicate user echoes.
  - Session switching transcript test passes.

### 9.6 Reimplement tail-first backfill using the store

- Keep `splitTurns()` and `takeTailChunk()` as pure helpers, preferably extracted to `messageUtils.js` or a transcript utility module with tests.
- Update `renderTranscript(messages)` to:
  - reset store
  - prefill prompt history from full message list as today
  - synchronously set tail chunk
  - asynchronously prepend older chunks
  - preserve scroll position when prepending
  - cancel stale jobs on session switch/reload
- Svelte keyed rendering should avoid remounting the tail when backfilling.
- Acceptance:
  - Large transcripts remain responsive.
  - Search jump after transcript load still works.
  - No scroll jump while backfilling.

### 9.7 Move checkpoint button placement into Svelte ✅

- Preserve `.checkpoint` selector, title, busy state, and click behavior.
- Keep checkpoint API orchestration in legacy behind bridge functions initially:
  - `requestCheckpoint()` or similar bridge callback.
- Store should expose the latest checkpoint-eligible item key.
- Svelte renders the iceberg on the latest user/assistant message.
- Acceptance:
  - Checkpoint treebar and rollback e2e tests pass.

### 9.8 Move permalink buttons into Svelte 🚧

- Add `PermalinkButton.svelte`.
- Preserve `.permalink`, title, icon, and click behavior.
- Initial implementation can call a legacy bridge method with either:
  - the rendered element, if unavoidable during transition, or
  - a transcript item key/entry hint, preferred.
- Preferred follow-up: make entry alignment data-driven by mapping transcript items to session entries instead of inspecting DOM text.
- Acceptance:
  - Permalink copy still works.
  - Search-hit focus and `/s/<session>/m/<entry>` behavior still work.

### 9.9 Rework search-hit focus/flash behavior

- Replace direct DOM scanning where possible with keyed transcript item focus.
- Keep legacy search orchestration but have it request:
  - ensure transcript fully rendered
  - set focused/flashing item key
  - scroll item into view
- Preserve existing visual flash class and timing.
- Acceptance:
  - `search across sessions and jump to a hit` e2e passes on desktop and mobile.

### 9.10 Remove replaced imperative transcript DOM code

After all prior phases are green:

- Remove unused DOM builders from `legacy.js`.
- Remove `toolCards` DOM map.
- Remove direct `messagesEl.innerHTML = ""` clearing, except any unavoidable root reset.
- Remove stale CSS only if no longer used.
- Run `rg` for stale function names and selectors.

## Testing Plan

After each small phase:

```sh
npm run build
npm test
```

After any behavior-affecting transcript change:

```sh
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```

Recommended new unit tests:

- `splitTurns()` and `takeTailChunk()` preserve tool call/result grouping.
- User interface briefing parsing.
- Assistant block normalization.
- Tool card status/result truncation data shaping.
- Message-to-entry matching after any permalink/search refactor.

Recommended targeted e2e while iterating:

```sh
cd tests/e2e
npx playwright test sessions.spec.js -g "switch between|search across" --workers=2
npx playwright test hublot.spec.js routine.spec.js --workers=2
npx playwright test checkpoint-treebar.spec.js checkpoint-rollback.spec.js --workers=2
```

## Risk Controls

- Keep every phase separately buildable and testable.
- Do not combine transcript rendering changes with session state migration.
- Prefer store updates from legacy before moving orchestration.
- Preserve selectors until all tests and legacy references are updated.
- Keep old helper functions until their Svelte replacement has passed full e2e.
- When changing streaming, test both live send and session reload paths.
- When changing backfill, test large transcript behavior manually if possible.

## Definition of Done for Step 9

Step 9 is complete when:

- `#messages` transcript contents are rendered by Svelte components.
- `legacy.js` no longer creates user/assistant/tool/thinking transcript DOM nodes directly.
- Legacy still may own SSE/RPC orchestration, but it updates transcript state through store/bridge functions.
- Checkpoint and permalink UI are Svelte-rendered and behavior-compatible.
- Search-hit jump/focus works.
- Full validation passes:

```sh
npm run build
npm test
docker build -t pi-lot-ui .
cd tests/e2e && npm test
```
