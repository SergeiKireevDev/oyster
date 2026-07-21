# Agent guidelines for pi-lot-ui

## Run the tests after every feature or fix

After implementing a feature or fixing a bug, run:

```sh
npm test
```

and make sure **all** tests pass before you consider the work done.

Why this is non-negotiable in this repo: the server hot-reloads `app.mjs` and
`public/index.html` **the moment you save them** — every edit deploys
instantly to live browser sessions. There is no build step or review gate to
catch mistakes. A single stale reference in the UI's inline script (e.g. a
top-level `$("removedElement").addEventListener(...)`) aborts the whole
script and takes down the page for everyone connected.

The suite is fast (<1s). It includes guards that specifically catch
hot-reload footguns:

- `tests/ui-page.test.mjs` — the inline script must parse, and every DOM id
  it references must exist in the markup. If you remove or rename an element
  in `index.html`, remove or update the code that references it.
- `tests/sessions.test.mjs`, `tests/checkpoints.test.mjs` — server-side
  behavior.

When you add a feature, prefer adding a test alongside it — especially for
anything in `app.mjs` request handling, where a regression silently breaks
remote clients.

## Editing `public/index.html`

- The whole UI is one file with one inline `<script>`. Top-level statements
  run at load; if any of them throw, the page is dead. Guard optional
  elements (`$("x")?.addEventListener(...)`) or wire listeners inside the
  code that creates the element.
- Saving the file broadcasts `ui_reload` to connected browsers, which may
  refresh immediately. Don't save half-finished states; make edits atomic.

## Editing `app.mjs`

- Hot-reloaded via `init(state)`. All state that must survive a reload
  (runners, SSE clients, buffers, tunnels) lives on the host-owned `state`
  object from `server.mjs` — never in module-level variables.
- If a reload fails to parse, the server keeps the previous version running
  and broadcasts `code_reload_failed`; check the journal
  (`journalctl --user -u pi-ui`) if your change doesn't seem to apply.
