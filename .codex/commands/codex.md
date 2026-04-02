---
description: Use Codex against the current repo without changing directories
---

# Codex

Use Codex directly against this repository root.

## Rules

1. Prefer the repo root rather than the caller's current directory.
2. If a task is provided, execute it against this repo.
3. If no task is provided, start an interactive Codex session for this repo.

Repo-local launcher:

```bash
codex-harness
```

Task-based execution:

```bash
codex exec --cd "<repo-root>" "$ARGUMENTS"
```
