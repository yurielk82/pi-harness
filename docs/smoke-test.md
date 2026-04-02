# Smoke Test

Use this after changing orchestration, commands, runners, or launchers.

## Automated

Run:

```bash
just smoke
```

This verifies:
- TypeScript compiles
- launchers are executable
- required workflow, agent, and command files exist
- `.claude/commands/` and `.codex/commands/` stay mirrored
- `pi-harness typecheck` still works

## Interactive

These checks cover runtime behavior that static tests do not prove.

### Lean Harness

Run:

```bash
pi-harness
```

Verify:
- the session launches without loading global extensions
- `/agents-list` prints the active team
- `/tilldone` responds
- a normal prompt routes through the dispatcher instead of editing directly

### Full Harness

Run:

```bash
pi-harness full
```

Verify:
- `/codex` is available
- `/system` is available
- imported commands from `.claude/commands/` load

### Team Routing

Use prompts like:

```text
Design a new backend service boundary for inventory reservations.
```

```text
Review a dbt model change and a warehouse contract for demand snapshots.
```

Verify:
- software/backend prompts route to the `software` team
- warehouse/data prompts route to the `data` team

### Chain Routing

Run:

```bash
pi-harness chain
```

Then verify:
- `/chain-list` works
- selecting `software-lifecycle` or `data-lifecycle` starts the expected sequence

### Safety

Verify:
- asking to read `.env` is blocked
- asking to run `git reset --hard` is blocked
- safe commands like `git status` still work

### Reflection

Verify:
- `/review-readiness` works
- `/retro` works
- `/learn` does not invent company-specific facts when docs remain `TBD`
