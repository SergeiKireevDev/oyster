---
title: Contributing
description: Build, test, document, and safely change the hot-reloaded application.
tags: contributing, tests, gitdocs
---

## Validate every change

```bash
npm test
```

The test suite is fast and is required after every feature or fix. Add focused coverage for request handling and browser composition when behavior changes.

For frontend work, also verify the production build:

```bash
npm run build
```

## Hot-reload safety

Saving backend or frontend application files can affect connected browsers immediately.

- Build the complete route table before swapping the active handler.
- Keep process-owned state on the stable `state` object.
- Do not leave stale DOM or component references after removing UI elements.
- Make browser changes as complete, atomic edits rather than saving broken intermediate states.
- Inspect service logs when a reload does not take effect.

## Documentation

The documentation uses [GitDocs](https://github.com/timberio/gitdocs) conventions:

- `.gitdocs.json` points at `docs/`.
- Every navigable directory has a `readme.md` index.
- YAML front matter supplies titles, descriptions, tags, and ordered `items`.
- Internal links use generated absolute routes such as `/operations/service/`.

Build the branded static site, then preview it:

```bash
npm run docs:build
python3 -m http.server 8000 --directory .gitdocs_build
```

Use the static production build for remote previews. GitDocs' development server embeds a loopback WebSocket, so tunnelling `gitdocs serve` leaves remote browsers on a loading skeleton. The generated `.gitdocs_build/` directory is ignored. Keep operational commands and security claims synchronized with the implementation and the root `README.md`.

## Pull-request checklist

1. Explain the behavior and operational impact.
2. Add or update tests.
3. Update the relevant GitDocs page.
4. Run `npm test` and, for UI changes, `npm run build`.
5. Do not commit tokens, provider credentials, `.ui-token`, databases, or generated output.
