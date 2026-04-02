# Contributing

This repository is intentionally narrow in scope. Treat it as a product repo for a
Pi-based coding harness, not an experiment dump.

## Ground Rules

- Keep the default workflow lean.
- Prefer additive opt-in features over default-on UI clutter.
- Treat `damage-control`, orchestration, and workflow discipline as core behavior.
- Do not reintroduce playground-only features unless there is a concrete workflow need.

## Change Process

1. Start with the workflow problem, not the implementation idea.
2. Keep changes small and testable.
3. Run `just typecheck` before opening a pull request.
4. Update `README.md` when behavior or launch modes change.
5. Update `.pi/agents/*` and `.pi/agents/*.yaml` when orchestration behavior changes.

## Pull Request Expectations

- Explain the user-facing workflow impact.
- Call out new commands, team changes, or chain changes.
- Mention risks or compatibility concerns with the Pi SDK.
