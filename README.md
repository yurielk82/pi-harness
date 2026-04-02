# pi-harness

Standalone Pi Coding Agent harness for day-to-day coding work.

This repository is private and intended to stay focused on a small, opinionated
workflow surface rather than a broad extension playground.

This repo extracts the useful orchestration pieces from `pi-vs-claude-code` into a separate, cleaner project:
- dispatcher-led specialist teams
- optional sequential chains
- tool-call safety rules
- purpose and task discipline
- optional cross-agent imports from `.claude`, `.codex`, and `.gemini`

It is designed to run in isolation from your global Pi extension state. Every launch command uses `--no-extensions` and loads only this repo's extensions.

## What Is Included

Core extensions:
- `agent-team`
- `agent-chain`
- `damage-control`
- `purpose-gate`
- `tilldone`

Optional extensions:
- `cross-agent`
- `system-select`
- `theme-cycler`

Workspace config:
- `.pi/agents/teams.yaml`
- `.pi/agents/agent-chain.yaml`
- `.pi/damage-control-rules.yaml`
- `.pi/settings.json`

## Prerequisites

- `pi`
- `bun`
- `just`

## Install

```bash
bun install
```

## API Keys

Pi does not auto-load `.env` by itself. Either source `.env` first or use the provided `just` recipes:

```bash
cp .env.sample .env
source .env
just harness
```

## Launch Modes

Lean dispatcher harness:

```bash
just harness
```

Lean chain harness:

```bash
just harness-chain
```

Full dispatcher harness with cross-agent imports and persona switching:

```bash
just harness-full
```

Full chain harness:

```bash
just harness-chain-full
```

Plain Pi with global extensions disabled:

```bash
just pi
```

Repo-local launcher:

```bash
./bin/pi-harness
./bin/pi-harness full
./bin/pi-harness chain
```

## Agents & Teams

<!-- Keep in sync with .pi/agents/ -->

### Agent Personas

Each agent runs as an isolated Pi subprocess with its own tools and persistent session state.

| Agent | Role | Tools | Writes Files? |
|-------|------|-------|---------------|
| `scout` | Fast recon and codebase exploration | read, bash, grep, find, ls | No |
| `planner` | Architecture and implementation planning | read, grep, find, ls | No |
| `builder` | Implementation and code generation | read, write, edit, bash, grep, find, ls | **Yes** |
| `reviewer` | Code review and quality checks | read, bash, grep, find, ls | No |
| `red-team` | Security and adversarial testing | read, bash, grep, find, ls | No |
| `plan-reviewer` | Plan critic — reviews, challenges, and validates implementation plans | read, grep, find, ls | No |
| `documenter` | Documentation and README generation | read, write, edit, grep, find, ls | **Yes** |
| `dispatcher` | Routes work to specialist agents instead of editing directly | dispatch_agent | No |

Agent definitions live in `.pi/agents/<name>.md`.

### Teams

Teams are named agent rosters loaded by the `agent-team` extension. Switch teams with `/agent-team <name>`.

| Team | Agents | Use When |
|------|--------|----------|
| `default` | scout, planner, builder, reviewer | General development |
| `fast-path` | planner, builder, reviewer | You already know the codebase |
| `research` | scout, planner, documenter, reviewer | Investigation & docs |
| `hardening` | planner, builder, reviewer, red-team | Security-sensitive changes |
| `full` | scout, planner, builder, reviewer, documenter, red-team | Full pipeline |
| `plan-build` | planner, builder, reviewer | Minimal planning + implementation |
| `info` | scout, documenter, reviewer | Pure information gathering |
| `frontend` | planner, builder, bowser | UI/frontend work |
| `pi-pi` | ext-expert, theme-expert, skill-expert, config-expert, tui-expert, prompt-expert, agent-expert | Pi-internal development |

Defined in `.pi/agents/teams.yaml`.

### Chain Pipelines

Chains are automated multi-step sequences where each agent's output feeds the next. Run with `just harness-chain` and use `/chain <name> <prompt>`.

| Chain | Steps | Description |
|-------|-------|-------------|
| `plan-build-review` | planner → builder → reviewer | Standard dev cycle |
| `scout-plan-build-review` | scout → planner → builder → reviewer | Larger/ambiguous tasks |
| `plan-build` | planner → builder | Fast two-step, no review |
| `scout-flow` | scout → scout → scout | Triple-pass deep recon |
| `plan-review-plan` | planner → plan-reviewer → planner | Iterative planning with critique |
| `full-review` | scout → planner → builder → reviewer | End-to-end pipeline |

Defined in `.pi/agents/agent-chain.yaml`.

## Default Workflow

`just harness` loads:
- `damage-control`
- `purpose-gate`
- `agent-team`
- `tilldone`

The default specialist team is:
- `scout`
- `planner`
- `plan-reviewer`
- `builder`
- `reviewer`

Persistent worker state is stored in `.pi/agent-sessions/`.

Useful commands:
- `/agents-team`
- `/agents-list`
- `/agents-reset`
- `/tilldone`

The default workflow is:
- `scout` when the request is ambiguous or needs repo discovery
- `planner` to produce the implementation plan
- `plan-reviewer` to critique the plan before code is written
- `builder` to make the change
- `reviewer` to check for bugs, regressions, and missing tests

Additional specialists:
- `documenter` for README/docs/example updates after implementation
- `red-team` for adversarial review of risky work like auth, secrets, migrations, infra, and destructive commands

## Full Workflow

`just harness-full` adds:
- `cross-agent`
- `system-select`
- `theme-cycler`

Cross-agent prompt discovery points at:
- `../.claude/commands`
- `../.codex/commands`
- `../.gemini/commands`

Available teams in [.pi/agents/teams.yaml](/Users/aconte/dev/pi-harness/.pi/agents/teams.yaml):
- `default` for normal coding work
- `fast-path` for lightweight plan-build-review work
- `research` for investigation-heavy tasks with documentation output
- `docs` when you expect documentation changes as part of the task
- `hardening` for risky or security-sensitive changes
- `full` when you want all specialists available

Available chains in [.pi/agents/agent-chain.yaml](/Users/aconte/dev/pi-harness/.pi/agents/agent-chain.yaml):
- `plan-build-review`
- `scout-plan-build-review`
- `plan-review-plan`
- `docs-finish`
- `hardening-review`

## Validation

```bash
just typecheck
```

CI runs the same typecheck on pushes and pull requests.

## Repo Layout

```text
pi-harness/
├── extensions/
├── .pi/
│   ├── agents/
│   ├── themes/
│   ├── damage-control-rules.yaml
│   └── settings.json
├── .claude/commands/
├── justfile
├── package.json
└── tsconfig.json
```
