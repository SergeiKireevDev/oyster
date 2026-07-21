---
title: Sessions and checkpoints
description: Work with saved conversations, forks, Git-backed checkpoints, and rollback.
tags: sessions, checkpoints, git
---

# Sessions and checkpoints

## Sessions

Each active runner is a pi process associated with a workspace and, after persistence, an opaque `ps1_…` session key. Use the session picker to resume, search, or remove saved conversations. SQLite session identity combines the database and session ID; do not treat the SQLite path alone as a session identifier.

The session sidebar groups forks under their root conversation and indicates which branches have a live runner.

## Create a checkpoint

1. Open a Git-backed workspace.
2. Select the iceberg action on the latest transcript message.
3. Optionally select a model to summarize the staged changes.
4. Confirm the checkpoint.

pi-lot-ui stages all workspace changes and creates a Git commit. If the worktree is already clean, it records the current `HEAD`. The checkpoint is anchored to the selected conversation entry.

## Roll back and fork

Select the return arrow on a checkpointed message. Pending work is checkpointed first so rollback does not discard it. The server then resets the worktree to the selected commit and asks pi to create a new session branch ending at the associated entry.

Rollback is intentionally a fork rather than a rewrite of the original conversation. Use the tree sidebar to move among the original line, forks, and their checkpoints.

> Checkpoints run `git add -A`, `git commit`, and `git reset --hard`. Review repository boundaries and ignored files before using them in a sensitive workspace.
