---
description: Use Codex against the current repo without leaving Claude workflow
---

# Codex

Use Codex as a deliberate second opinion or implementation worker for this repository.

## Rules

1. Resolve the repo root first:
   - prefer `git rev-parse --show-toplevel`
   - fall back to the current working directory if needed
2. Do not ask the user to `cd` manually.
3. If the user provided a task, prefer a non-interactive Codex run:
   - `codex exec --cd "<repo-root>" "<task>"`
4. If the user did not provide a task and clearly wants an interactive Codex session, launch:
   - `codex-harness`
5. After Codex returns, summarize:
   - what it did
   - what changed
   - any risks or follow-up

## Arguments

`$ARGUMENTS`

If arguments are present, treat them as the Codex task to run.
