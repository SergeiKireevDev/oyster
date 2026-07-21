---
title: Sessions
description: Create, resume, search, switch, and remove saved conversations.
tags: sessions, conversations, runners
---

Each active runner is a pi process associated with a workspace and, after persistence, an opaque `ps1_…` session key. Use the session picker to resume, search, or remove saved conversations.

## Work with sessions

- Start a new conversation from the header or command palette.
- Use the session picker to resume durable conversation history.
- Search within the current session, workspace, or all known sessions.
- Switch active runners from the session sidebar.
- Stop a runner without deleting its saved conversation.
- Delete a saved session when its backend supports deletion.

SQLite session identity combines the database and session ID; do not treat the SQLite path alone as a session identifier. New clients should use the opaque session key rather than JSONL compatibility paths.

The session sidebar groups related conversations and indicates which entries have a live or busy runner. Selecting a saved session opens it in its original workspace when that directory remains available.
